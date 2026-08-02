use chrono::Utc;
use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{UnixListener, UnixStream};
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::{RwLock, mpsc};
use uuid::Uuid;

use crate::framing::{self, FrameError, LENGTH_PREFIX_SIZE, MAX_FRAME_SIZE};
use crate::registry::SessionRegistry;
use crate::types::{AckOutcome, EventType, MessageEnvelope, RequestId, SessionId};

/// Pending request awaiting a session response: the owning session and the
/// channel relaying the response back to the waiting producer.
type Pending = HashMap<RequestId, (SessionId, mpsc::Sender<EventType>)>;

/// Bind, accept loop, spawn per-connection handler.
/// Probes the socket first: refuses to start if another daemon already owns
/// it, and only unlinks the path when the probe shows it is stale or
/// unavailable. On SIGTERM/SIGINT unlinks the socket and returns `Ok(())`
/// so the process exits 0.
pub async fn run(socket_path: &Path) -> anyhow::Result<()> {
    // Installed before the socket exists, so a signal can never race the
    // accept loop's handlers.
    let mut sigterm = signal(SignalKind::terminate())?;
    let mut sigint = signal(SignalKind::interrupt())?;

    // Probe before cleanup: a successful connection means another daemon is
    // live on this path — refuse rather than unlink its listener out from
    // under it. A failed connect means the path is stale or nonexistent,
    // so it is safe to unlink and bind.
    match UnixStream::connect(socket_path).await {
        Ok(_) => anyhow::bail!(
            "socket {} already in use by another daemon",
            socket_path.display()
        ),
        Err(_) => match fs_err::remove_file(socket_path) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("failed to unlink stale socket: {e}"),
        },
    }

    if let Some(parent) = socket_path.parent() {
        fs_err::create_dir_all(parent)?;
    }

    let listener = UnixListener::bind(socket_path)?;
    let registry = Arc::new(SessionRegistry::new());
    // pending: producers awaiting a session response, keyed by request_id,
    // tagged with the session that owns the request.
    let pending: Arc<RwLock<Pending>> = Arc::new(RwLock::new(HashMap::new()));

    tracing::info!("listening on {}", socket_path.display());

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                // Transient accept failures (e.g. fd exhaustion) must not
                // kill the daemon: log and keep accepting.
                match accepted {
                    Ok((stream, _addr)) => {
                        let registry = Arc::clone(&registry);
                        let pending = Arc::clone(&pending);
                        tokio::spawn(handle_connection(stream, registry, pending));
                    }
                    Err(e) => tracing::warn!("accept failed: {e}"),
                }
            }
            _ = sigterm.recv() => break,
            _ = sigint.recv() => break,
        }
    }

    if let Err(e) = fs_err::remove_file(socket_path) {
        tracing::warn!("failed to unlink socket on shutdown: {e}");
    }
    tracing::info!("shutdown complete");
    Ok(())
}

/// Classify connection by first frame, dispatch to session or producer handler.
async fn handle_connection(
    stream: UnixStream,
    registry: Arc<SessionRegistry>,
    pending: Arc<RwLock<Pending>>,
) {
    let (mut reader, writer) = stream.into_split();

    // Read first frame — determines session vs producer. Bounded so a
    // connected-but-silent client can't hold a task (and its socket) forever.
    let envelope =
        match tokio::time::timeout(Duration::from_secs(10), read_frame(&mut reader)).await {
            Ok(Ok(env)) => env,
            Ok(Err(e)) => {
                tracing::warn!("failed to read initial frame: {e}");
                return;
            }
            Err(_) => {
                tracing::warn!("timed out waiting for initial frame");
                return;
            }
        };

    match &envelope.event {
        EventType::SessionRegister { .. } => {
            handle_session(reader, writer, envelope, registry, pending).await;
        }
        EventType::ReviewSubmit { .. } | EventType::ReportSubmit { .. } => {
            drop(reader);
            handle_producer(writer, envelope, registry, pending).await;
        }
        _ => {
            tracing::warn!("unexpected initial event: {:?}", envelope.event);
        }
    }
}

/// Persistent pi session connection.
/// Registers on `session.register`, enters read-loop:
///   - `session.unregister`: explicit unregister, break
///   - `review.completed` / `report.completed`: lookup request_id in pending,
///     forward to producer, remove from pending
///   - connection close / error: auto-unregister + pending cleanup
async fn handle_session(
    mut reader: OwnedReadHalf,
    mut writer: OwnedWriteHalf,
    first: MessageEnvelope,
    registry: Arc<SessionRegistry>,
    pending: Arc<RwLock<Pending>>,
) {
    let EventType::SessionRegister {
        session_id,
        project_path,
    } = first.event
    else {
        return; // unreachable, handle_connection already checked
    };

    let (mut session_rx, _) = registry.register(project_path, session_id).await;

    loop {
        tokio::select! {
            // Forward daemon->session routed events out to pi
            Some(event) = session_rx.recv() => {
                let envelope = MessageEnvelope {
                    id: Uuid::new_v4(),
                    timestamp: Utc::now().to_rfc3339(),
                    event,
                };
                if write_frame(&mut writer, &envelope).await.is_err() {
                    break;
                }
            }

            // Read pi->daemon events
            result = read_frame(&mut reader) => {
                match result {
                    Ok(envelope) => match &envelope.event {
                        EventType::SessionUnregister { .. } => break,
                        EventType::ReviewCompleted { request_id, .. }
                        | EventType::ReportCompleted { request_id, .. } => {
                            let mut map = pending.write().await;
                            if let Some((_, tx)) = map.remove(request_id) {
                                let _ = tx.send(envelope.event).await;
                            }
                        }
                        _ => {} // ignore unknown
                    },
                    Err(_) => break, // connection closed or malformed frame
                }
            }
        }
    }
    registry.unregister(&session_id).await;

    // Drop every pending request routed to this session (both break paths
    // land here): closing the senders ends any waiting producers, and the
    // entries don't linger in the map.
    pending
        .write()
        .await
        .retain(|_, (sid, _)| *sid != session_id);
}

/// One-shot producer connection (review.submit / report.submit).
///   1. Look up session by project_path (or session_id for report.submit).
///   2. If found, send `review.ack { accepted }`, then:
///      a. Register request_id in pending with a oneshot sender
///      b. Forward event to session's mpsc channel
///      c. Await response from session
///      d. Write response frame to producer, close
///   3. If not found, send `review.ack { rejected }`, close
async fn handle_producer(
    mut writer: OwnedWriteHalf,
    first: MessageEnvelope,
    registry: Arc<SessionRegistry>,
    pending: Arc<RwLock<Pending>>,
) {
    // Reject a duplicate request_id before any ack: replacing the existing
    // pending sender would strand the original producer forever.
    if let EventType::ReviewSubmit { request_id, .. } | EventType::ReportSubmit { request_id, .. } =
        &first.event
        && pending.read().await.contains_key(request_id)
    {
        send_ack(
            &mut writer,
            request_id,
            AckOutcome::Rejected {
                reason: "duplicate_request".into(),
                message: Some("A submission with this id is already pending".into()),
            },
        )
        .await;
        return;
    }

    let (request_id, session, forward_msg) = match &first.event {
        EventType::ReviewSubmit {
            request_id,
            project_path,
            snippet,
        } => match registry.find(project_path).await {
            Some(s) => {
                send_ack(
                    &mut writer,
                    request_id,
                    AckOutcome::Accepted {
                        session_id: s.session_id,
                        message: None,
                    },
                )
                .await;
                (
                    *request_id,
                    s,
                    EventType::ReviewRequested {
                        request_id: *request_id,
                        snippet: snippet.clone(),
                    },
                )
            }
            None => {
                send_ack(
                    &mut writer,
                    request_id,
                    AckOutcome::Rejected {
                        reason: "no_active_session".into(),
                        message: Some("No active pi session for this project".into()),
                    },
                )
                .await;
                return;
            }
        },
        EventType::ReportSubmit {
            request_id,
            session_id,
            content,
        } => match registry.find_by_session_id(session_id).await {
            Some(s) => {
                send_ack(
                    &mut writer,
                    request_id,
                    AckOutcome::Accepted {
                        session_id: s.session_id,
                        message: None,
                    },
                )
                .await;
                (
                    *request_id,
                    s,
                    EventType::ReportDelivered {
                        request_id: *request_id,
                        content: content.clone(),
                    },
                )
            }
            None => {
                send_ack(
                    &mut writer,
                    request_id,
                    AckOutcome::Rejected {
                        reason: "session_not_found".into(),
                        message: Some("Target session not registered".into()),
                    },
                )
                .await;
                return;
            }
        },
        _ => return, // unreachable
    };

    // Forward to session, register pending, await response. The insert is
    // atomic with a re-check: if a concurrent submission with the same
    // request_id slipped in after the pre-ack check, the original producer's
    // pending entry is preserved and this connection is closed rather than
    // left waiting.
    let (tx, mut rx) = mpsc::channel::<EventType>(1);
    {
        let mut pending_guard = pending.write().await;
        if pending_guard.contains_key(&request_id) {
            return;
        }
        pending_guard.insert(request_id, (session.session_id, tx));
    }

    if session.sender.send(forward_msg).await.is_err() {
        pending.write().await.remove(&request_id);
        return;
    }

    // Await the session's response, bounded: a session that accepts a request
    // but never answers must not leave the producer waiting forever.
    let response = match tokio::time::timeout(Duration::from_secs(30), rx.recv()).await {
        Ok(Some(event)) => Some(event),
        Ok(None) => {
            tracing::warn!("session dropped request {request_id:?} without answering");
            None
        }
        Err(_) => {
            tracing::warn!("request {request_id:?} timed out waiting for session");
            None
        }
    };
    // Idempotent: the session already removed the entry when it answered;
    // this clears it on the timeout and abandoned paths.
    pending.write().await.remove(&request_id);

    if let Some(event) = response {
        let envelope = MessageEnvelope {
            id: Uuid::new_v4(),
            timestamp: String::new(),
            event,
        };
        let _ = write_frame(&mut writer, &envelope).await;
    }
}

async fn send_ack(writer: &mut OwnedWriteHalf, request_id: &RequestId, outcome: AckOutcome) {
    let envelope = MessageEnvelope {
        id: Uuid::new_v4(),
        timestamp: Utc::now().to_rfc3339(),
        event: EventType::ReviewAck {
            request_id: *request_id,
            outcome,
        },
    };
    let _ = write_frame(writer, &envelope).await;
}

/// Read one length-prefixed frame from the buffered reader.
/// Reads the full frame (4-byte BE length prefix + declared payload) and
/// hands it to `framing::decode`, which expects the length prefix.
async fn read_frame(reader: &mut OwnedReadHalf) -> Result<MessageEnvelope, FrameError> {
    let mut len_buf = [0u8; LENGTH_PREFIX_SIZE];
    reader.read_exact(&mut len_buf).await?;
    let declared = u32::from_be_bytes(len_buf);
    // Reject oversized declarations before allocating: a malicious peer can
    // otherwise force a multi-GB allocation from a 4-byte prefix.
    if declared as usize > MAX_FRAME_SIZE {
        return Err(FrameError::TooLarge(declared));
    }
    let mut frame = vec![0u8; LENGTH_PREFIX_SIZE + declared as usize];
    frame[..LENGTH_PREFIX_SIZE].copy_from_slice(&len_buf);
    reader.read_exact(&mut frame[LENGTH_PREFIX_SIZE..]).await?;
    framing::decode(&frame)
}

/// Write a MessageEnvelope as a length-prefixed frame to the owned write half.
async fn write_frame(writer: &mut OwnedWriteHalf, msg: &MessageEnvelope) -> Result<(), FrameError> {
    let frame = framing::encode(msg)?;
    writer.write_all(&frame).await?;
    Ok(())
}
