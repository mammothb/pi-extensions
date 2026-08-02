use chrono::Utc;
use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{RwLock, mpsc};
use uuid::Uuid;

use crate::framing::{self, FrameError, LENGTH_PREFIX_SIZE};
use crate::registry::SessionRegistry;
use crate::types::{AckOutcome, EventType, MessageEnvelope, RequestId};

/// Bind, accept loop, spawn per-connection handler.
/// Removes stale socket file before binding.
pub async fn run(socket_path: &Path) -> anyhow::Result<()> {
    match fs_err::remove_file(socket_path) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => tracing::warn!("failed to unlink stale socket: {e}"),
    }

    if let Some(parent) = socket_path.parent() {
        fs_err::create_dir_all(parent)?;
    }

    let listener = UnixListener::bind(socket_path)?;
    let registry = Arc::new(SessionRegistry::new());
    // pending: producers awaiting a session response, keyed by request_id
    let pending: Arc<RwLock<HashMap<RequestId, mpsc::Sender<EventType>>>> =
        Arc::new(RwLock::new(HashMap::new()));

    tracing::info!("listening on {}", socket_path.display());

    loop {
        let (stream, _addr) = listener.accept().await?;
        let registry = Arc::clone(&registry);
        let pending = Arc::clone(&pending);
        tokio::spawn(handle_connection(stream, registry, pending));
    }
}

/// Classify connection by first frame, dispatch to session or producer handler.
async fn handle_connection(
    stream: UnixStream,
    registry: Arc<SessionRegistry>,
    pending: Arc<RwLock<HashMap<RequestId, mpsc::Sender<EventType>>>>,
) {
    let (mut reader, writer) = stream.into_split();

    // Read first frame — determines session vs producer
    let envelope = match read_frame(&mut reader).await {
        Ok(env) => env,
        Err(e) => {
            tracing::warn!("failed to read initial frame: {e}");
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
///   - `review.completed`: lookup request_id in pending, forward to producer,
///     remove from pending
///   - connection close / error: auto-unregister
async fn handle_session(
    mut reader: OwnedReadHalf,
    mut writer: OwnedWriteHalf,
    first: MessageEnvelope,
    registry: Arc<SessionRegistry>,
    pending: Arc<RwLock<HashMap<RequestId, mpsc::Sender<EventType>>>>,
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
                        EventType::ReviewCompleted { request_id, .. } => {
                            let mut map = pending.write().await;
                            if let Some(tx) = map.remove(request_id) {
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
    pending: Arc<RwLock<HashMap<RequestId, mpsc::Sender<EventType>>>>,
) {
    let (request_id, session) = match &first.event {
        EventType::ReviewSubmit {
            request_id,
            project_path,
            ..
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
                (*request_id, s)
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
            ..
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
                (*request_id, s)
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

    // Forward to session, register pending, await response
    let (tx, mut rx) = mpsc::channel::<EventType>(1);
    pending.write().await.insert(request_id, tx);

    let (forward_msg, request_id, session) = match &first.event {
        EventType::ReviewSubmit {
            request_id,
            snippet,
            ..
        } => {
            let forward_msg = EventType::ReviewRequested {
                request_id: *request_id,
                snippet: snippet.clone(),
            };
            (forward_msg, *request_id, session)
        }
        EventType::ReportSubmit {
            request_id,
            content,
            ..
        } => {
            let forward_msg = EventType::ReportDelivered {
                request_id: *request_id,
                content: content.clone(),
            };
            (forward_msg, *request_id, session)
        }
        _ => unreachable!(),
    };

    if session.sender.send(forward_msg).await.is_err() {
        pending.write().await.remove(&request_id);
        return;
    }

    if let Some(event) = rx.recv().await {
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
        timestamp: String::new(),
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
