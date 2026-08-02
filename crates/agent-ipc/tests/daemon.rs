use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use rstest::rstest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use uuid::Uuid;

use agent_ipc::framing;
use agent_ipc::types::{AckOutcome, EventType, MessageEnvelope, RequestId, SessionId};

/// In-process daemon on a temp socket. `aipcd` is a long-running daemon, so
/// tests drive `server::run` directly instead of spawning the binary.
struct TestDaemon {
    socket_path: PathBuf,
    /// Keeps the socket file alive for the lifetime of the test.
    _dir: tempfile::TempDir,
    _task: tokio::task::JoinHandle<anyhow::Result<()>>,
}

/// Polls until a connection to `socket` succeeds.
async fn wait_until_connectable(socket: &Path) {
    let mut attempts = 0;
    while UnixStream::connect(socket).await.is_err() {
        tokio::time::sleep(Duration::from_millis(5)).await;
        attempts += 1;
        assert!(attempts < 200, "daemon socket never appeared");
    }
}

impl TestDaemon {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let socket_path = dir.path().join("daemon.sock");
        let run_socket = socket_path.clone();
        let task = tokio::spawn(async move { agent_ipc::server::run(&run_socket).await });

        wait_until_connectable(&socket_path).await;

        Self {
            socket_path,
            _dir: dir,
            _task: task,
        }
    }
}

// =======
// startup
// =======

#[rstest]
#[tokio::test]
async fn parent_dir_created() {
    let dir = tempfile::tempdir().unwrap();
    // Nested path — neither the parent nor the socket exists yet.
    let socket_path = dir.path().join("nested").join("daemon.sock");
    let run_socket = socket_path.clone();
    let task = tokio::spawn(async move { agent_ipc::server::run(&run_socket).await });

    wait_until_connectable(&socket_path).await;

    let parent = socket_path.parent().unwrap();
    assert!(
        parent.exists(),
        "daemon must create the socket's parent dir"
    );
    drop(task);
}

#[rstest]
#[tokio::test]
async fn stale_socket_cleaned() {
    let dir = tempfile::tempdir().unwrap();
    let socket_path = dir.path().join("daemon.sock");

    // Orphaned socket file, as if a previous daemon crashed: bind() creates
    // the inode, dropping the listener leaves it behind.
    let stale = UnixListener::bind(&socket_path).unwrap();
    drop(stale);
    assert!(socket_path.exists());

    let run_socket = socket_path.clone();
    let task = tokio::spawn(async move { agent_ipc::server::run(&run_socket).await });

    // Binding the same path only succeeds if the stale socket was unlinked.
    wait_until_connectable(&socket_path).await;
    drop(task);
}

// =============
// wire protocol
// =============

fn rid(n: u8) -> RequestId {
    RequestId(Uuid::from_bytes([n; 16]))
}

fn sid(n: u8) -> SessionId {
    SessionId(Uuid::from_bytes([n; 16]))
}

fn envelope(event: EventType) -> MessageEnvelope {
    MessageEnvelope {
        id: Uuid::new_v4(),
        timestamp: String::new(),
        event,
    }
}

async fn connect(socket: &Path) -> UnixStream {
    UnixStream::connect(socket).await.unwrap()
}

async fn send_frame(stream: &mut UnixStream, event: EventType) {
    let frame = framing::encode(&envelope(event)).unwrap();
    stream.write_all(&frame).await.unwrap();
}

/// Reads one length-prefixed frame, mirroring `server::read_frame`: the
/// full frame (4-byte length prefix + declared payload) is handed to
/// `framing::decode`, which expects the prefix.
async fn read_frame(stream: &mut UnixStream) -> MessageEnvelope {
    let mut len_buf = [0u8; framing::LENGTH_PREFIX_SIZE];
    stream.read_exact(&mut len_buf).await.unwrap();
    let declared = u32::from_be_bytes(len_buf);
    let mut frame = vec![0u8; framing::LENGTH_PREFIX_SIZE + declared as usize];
    frame[..framing::LENGTH_PREFIX_SIZE].copy_from_slice(&len_buf);
    stream
        .read_exact(&mut frame[framing::LENGTH_PREFIX_SIZE..])
        .await
        .unwrap();
    framing::decode(&frame).unwrap()
}

async fn register_session(stream: &mut UnixStream, session_id: SessionId, project: &Path) {
    send_frame(
        stream,
        EventType::SessionRegister {
            session_id,
            project_path: project.to_path_buf(),
        },
    )
    .await;
}

async fn submit_and_read_ack(
    stream: &mut UnixStream,
    request_id: RequestId,
    project: &Path,
    snippet: &str,
) -> AckOutcome {
    send_frame(
        stream,
        EventType::ReviewSubmit {
            request_id,
            project_path: project.to_path_buf(),
            snippet: snippet.to_string(),
        },
    )
    .await;
    let env = read_frame(stream).await;
    match env.event {
        EventType::ReviewAck { outcome, .. } => outcome,
        other => panic!("expected review.ack, got {other:?}"),
    }
}

fn assert_ack_wire_status(env: &MessageEnvelope, expected: &str) {
    let value = serde_json::to_value(env).unwrap();
    let ack = value.get("review.ack").unwrap().as_object().unwrap();
    assert_eq!(ack.get("status").and_then(|v| v.as_str()), Some(expected));
}

/// Polls with fresh producer connections until the daemon rejects a
/// submission for `project` (i.e. the session is gone). Probes that get
/// accepted are dropped without awaiting a response.
async fn wait_until_rejected(socket: &Path, project: &Path) {
    for _ in 0..100 {
        let mut conn = connect(socket).await;
        match submit_and_read_ack(&mut conn, rid(0xEE), project, "probe").await {
            AckOutcome::Rejected { .. } => return,
            AckOutcome::Accepted { .. } => {
                drop(conn);
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    }
    panic!("daemon never rejected the probe submission");
}

// =================
// session lifecycle
// =================

#[rstest]
#[tokio::test]
async fn session_register_and_unregister() {
    let daemon = TestDaemon::start().await;
    let project = PathBuf::from("/proj/reg");
    let id = sid(1);

    let mut conn = connect(&daemon.socket_path).await;
    register_session(&mut conn, id, &project).await;
    send_frame(&mut conn, EventType::SessionUnregister { session_id: id }).await;
    drop(conn);

    // Session gone from the registry → producer is rejected.
    wait_until_rejected(&daemon.socket_path, &project).await;
}

#[rstest]
#[tokio::test]
async fn session_drop_unregisters() {
    let daemon = TestDaemon::start().await;
    let project = PathBuf::from("/proj/drop");
    let id = sid(1);

    let mut conn = connect(&daemon.socket_path).await;
    register_session(&mut conn, id, &project).await;
    drop(conn); // no explicit session.unregister

    wait_until_rejected(&daemon.socket_path, &project).await;
}

// ==============
// producer flows
// ==============

#[rstest]
#[tokio::test]
async fn producer_rejected_no_session() {
    let daemon = TestDaemon::start().await;
    let project = PathBuf::from("/proj/ghost");

    let mut conn = connect(&daemon.socket_path).await;
    let outcome = submit_and_read_ack(&mut conn, rid(1), &project, "fn main() {}").await;
    let AckOutcome::Rejected { reason, .. } = outcome else {
        panic!("expected rejected, got {outcome:?}");
    };
    assert_eq!(reason, "no_active_session");
}

#[rstest]
#[tokio::test]
async fn producer_accepted_with_session() {
    let daemon = TestDaemon::start().await;
    let project = PathBuf::from("/proj/accept");
    let id = sid(1);

    let mut session_conn = connect(&daemon.socket_path).await;
    register_session(&mut session_conn, id, &project).await;

    let mut producer = connect(&daemon.socket_path).await;
    let rid = rid(2);
    send_frame(
        &mut producer,
        EventType::ReviewSubmit {
            request_id: rid,
            project_path: project.clone(),
            snippet: "fn main() {}".into(),
        },
    )
    .await;
    let env = read_frame(&mut producer).await;
    assert_ack_wire_status(&env, "accepted");
    match env.event {
        EventType::ReviewAck {
            outcome: AckOutcome::Accepted { session_id, .. },
            ..
        } => assert_eq!(session_id, id),
        other => panic!("expected accepted review.ack, got {other:?}"),
    }
}

#[rstest]
#[tokio::test]
async fn producer_gets_response() {
    let daemon = TestDaemon::start().await;
    let project = PathBuf::from("/proj/resp");
    let id = sid(1);
    let rid = rid(2);

    let mut session_conn = connect(&daemon.socket_path).await;
    register_session(&mut session_conn, id, &project).await;

    let mut producer = connect(&daemon.socket_path).await;
    let outcome = submit_and_read_ack(&mut producer, rid, &project, "fn main() {}").await;
    assert!(matches!(outcome, AckOutcome::Accepted { .. }));

    // Session receives review.requested and replies review.completed.
    let env = read_frame(&mut session_conn).await;
    let EventType::ReviewRequested {
        request_id,
        snippet,
    } = env.event
    else {
        panic!("expected review.requested, got {:?}", env.event);
    };
    assert_eq!(request_id, rid);
    assert_eq!(snippet, "fn main() {}");
    send_frame(
        &mut session_conn,
        EventType::ReviewCompleted {
            request_id,
            review: "looks good".into(),
        },
    )
    .await;

    // Producer receives the relayed review.completed.
    let env = read_frame(&mut producer).await;
    let EventType::ReviewCompleted { request_id, review } = env.event else {
        panic!("expected review.completed, got {:?}", env.event);
    };
    assert_eq!(request_id, rid);
    assert_eq!(review, "looks good");
}

#[rstest]
#[tokio::test]
async fn newest_session_wins() {
    let daemon = TestDaemon::start().await;
    let project = PathBuf::from("/proj/newest");
    let old_id = sid(1);
    let new_id = sid(2);
    let rid = rid(3);

    let mut session_old = connect(&daemon.socket_path).await;
    register_session(&mut session_old, old_id, &project).await;
    let mut session_new = connect(&daemon.socket_path).await;
    register_session(&mut session_new, new_id, &project).await;

    let mut producer = connect(&daemon.socket_path).await;
    let outcome = submit_and_read_ack(&mut producer, rid, &project, "fn main() {}").await;
    let AckOutcome::Accepted { session_id, .. } = outcome else {
        panic!("expected accepted, got {outcome:?}");
    };
    assert_eq!(session_id, new_id, "routing must pick the newest session");

    // The review.requested is relayed to the newest session's connection.
    let env = read_frame(&mut session_new).await;
    let EventType::ReviewRequested { request_id, .. } = env.event else {
        panic!(
            "expected review.requested on newest session, got {:?}",
            env.event
        );
    };
    assert_eq!(request_id, rid);
    send_frame(
        &mut session_new,
        EventType::ReviewCompleted {
            request_id,
            review: "looks good".into(),
        },
    )
    .await;

    let env = read_frame(&mut producer).await;
    let EventType::ReviewCompleted {
        request_id: _rid, ..
    } = env.event
    else {
        panic!("expected review.completed, got {:?}", env.event);
    };
}

// ===========
// concurrency
// ===========

#[rstest]
#[tokio::test]
async fn concurrent_producers() {
    let daemon = TestDaemon::start().await;
    let project = PathBuf::from("/proj/conc");
    let id = sid(1);
    let num_producers = 3;

    let mut session_conn = connect(&daemon.socket_path).await;
    register_session(&mut session_conn, id, &project).await;

    // Session connection is serviced from a task: read review.requested,
    // answer review.completed, until three requests have been handled.
    let session_task = tokio::spawn(async move {
        let mut count = 0;
        for _ in 0..num_producers {
            let env = read_frame(&mut session_conn).await;
            let EventType::ReviewRequested { request_id, .. } = env.event else {
                panic!("expected review.requested, got {:?}", env.event);
            };
            send_frame(
                &mut session_conn,
                EventType::ReviewCompleted {
                    request_id,
                    review: "looks good".into(),
                },
            )
            .await;
            count += 1;
        }
        count
    });

    // Three producers fire at once; each expects Accepted + a relayed response.
    let barrier = Arc::new(tokio::sync::Barrier::new(num_producers));
    let mut producers = Vec::new();
    for n in 0..num_producers {
        let socket = daemon.socket_path.clone();
        let project = project.clone();
        let barrier = Arc::clone(&barrier);
        producers.push(tokio::spawn(async move {
            barrier.wait().await;
            let mut conn = connect(&socket).await;
            let rid = rid(n as u8);
            let outcome = submit_and_read_ack(&mut conn, rid, &project, "fn main() {}").await;
            assert!(matches!(outcome, AckOutcome::Accepted { .. }));
            let env = read_frame(&mut conn).await;
            (rid, env)
        }));
    }

    for task in producers {
        let (rid, env) = task.await.unwrap();
        let EventType::ReviewCompleted { request_id, review } = env.event else {
            panic!("expected review.completed, got {:?}", env.event);
        };
        assert_eq!(request_id, rid);
        assert_eq!(review, "looks good");
    }

    assert_eq!(session_task.await.unwrap(), num_producers);
}

// ========
// shutdown
// ========

/// Spawns the real `aipcd` binary — unlike `TestDaemon` above, signals
/// require a real process.
fn spawn_binary(socket: &Path) -> std::process::Child {
    std::process::Command::new(assert_cmd::cargo::cargo_bin!("aipcd"))
        .arg("--socket-path")
        .arg(socket)
        .spawn()
        .unwrap()
}

fn send_signal(child: &std::process::Child, signal: libc::c_int) {
    // SAFETY: `child` is a live child of this process; kill(2) is passed the
    // child's real pid and a valid signal number.
    unsafe {
        libc::kill(child.id() as libc::pid_t, signal);
    }
}

#[rstest]
#[tokio::test]
async fn sigterm_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("daemon.sock");
    let mut child = spawn_binary(&socket);
    wait_until_connectable(&socket).await;

    send_signal(&child, libc::SIGTERM);

    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(0));
    assert!(!socket.exists(), "socket must be unlinked on shutdown");
}

#[rstest]
#[tokio::test]
async fn sigint_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let socket = dir.path().join("daemon.sock");
    let mut child = spawn_binary(&socket);
    wait_until_connectable(&socket).await;

    send_signal(&child, libc::SIGINT);

    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(0));
    assert!(!socket.exists(), "socket must be unlinked on shutdown");
}
