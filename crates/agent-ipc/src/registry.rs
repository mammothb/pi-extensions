use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::sync::{RwLock, mpsc};

use crate::types::{EventType, SessionId};

/// Session registry keyed by project_path.
/// Multiple sessions per path allowed; routing picks newest.
pub struct SessionRegistry {
    /// project_path -> registration_time -> SessionHandle
    sessions: RwLock<HashMap<PathBuf, BTreeMap<Instant, SessionHandle>>>,
    /// session_id -> (project_path, registration_time) - reverse index for O(1)
    /// unregister
    index: RwLock<HashMap<SessionId, (PathBuf, Instant)>>,
}

#[derive(Clone)]
pub struct SessionHandle {
    pub session_id: SessionId,
    /// Channel to push daemon→pi messages to the session's connection task.
    pub sender: mpsc::Sender<EventType>,
}

/// Per-session message channel capacity.
/// At 32, the daemon blocks producers before a stalled session consumes
/// unbounded memory.
const SESSION_CHANNEL_SIZE: usize = 32;

impl Default for SessionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            index: RwLock::new(HashMap::new()),
        }
    }

    /// Returns a receiver the session's connection task awaits on for incoming
    /// routed messages. The handle is stored in the registry.
    pub async fn register(
        &self,
        project_path: PathBuf,
        session_id: SessionId,
    ) -> (mpsc::Receiver<EventType>, SessionHandle) {
        let (tx, rx) = mpsc::channel(SESSION_CHANNEL_SIZE);
        let handle = SessionHandle {
            session_id,
            sender: tx,
        };
        let now = Instant::now();
        self.sessions
            .write()
            .await
            .entry(project_path.clone())
            .or_default()
            .insert(now, handle.clone());
        self.index
            .write()
            .await
            .insert(session_id, (project_path, now));
        (rx, handle)
    }

    /// Removes session by id. Returns true if removed, false if not found.
    pub async fn unregister(&self, session_id: &SessionId) -> bool {
        let (project_path, instant) = match self.index.write().await.remove(session_id) {
            Some(entry) => entry,
            None => return false,
        };

        let mut sessions = self.sessions.write().await;
        if let Some(map) = sessions.get_mut(&project_path) {
            map.remove(&instant);
            if map.is_empty() {
                sessions.remove(&project_path);
            }
        }
        true
    }
    /// Find the newest session for a project path.
    pub async fn find(&self, project_path: &Path) -> Option<SessionHandle> {
        self.sessions
            .read()
            .await
            .get(project_path)
            .and_then(|map| map.last_key_value())
            .map(|(_, handle)| handle.clone())
    }

    pub async fn find_by_session_id(&self, session_id: &SessionId) -> Option<SessionHandle> {
        let index = self.index.read().await;
        let (project_path, instant) = index.get(session_id)?;
        let sessions = self.sessions.read().await;
        sessions.get(project_path)?.get(instant).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use std::sync::Arc;
    use uuid::Uuid;

    /// Deterministic session id for test index `n`.
    fn session_id(n: u8) -> SessionId {
        SessionId(Uuid::from_bytes([n; 16]))
    }

    // ===============
    // register + find
    // ===============

    #[rstest]
    #[tokio::test]
    async fn register_and_find() {
        let registry = SessionRegistry::new();
        let path = PathBuf::from("/proj/a");
        let id = session_id(1);

        let (_rx, handle) = registry.register(path.clone(), id).await;
        assert_eq!(handle.session_id, id);

        let found = registry.find(&path).await.unwrap();
        assert_eq!(found.session_id, id);
    }

    #[rstest]
    #[tokio::test]
    async fn find_returns_newest() {
        let registry = SessionRegistry::new();
        let path = PathBuf::from("/proj/a");

        let (_, older) = registry.register(path.clone(), session_id(1)).await;
        let (_, newer) = registry.register(path.clone(), session_id(2)).await;
        assert_ne!(older.session_id, newer.session_id);

        let found = registry.find(&path).await.unwrap();
        assert_eq!(found.session_id, newer.session_id);
    }

    #[rstest]
    #[tokio::test]
    async fn unregister_removes() {
        let registry = SessionRegistry::new();
        let path = PathBuf::from("/proj/a");
        let id = session_id(1);
        registry.register(path.clone(), id).await;

        assert!(registry.unregister(&id).await);
        assert!(registry.find(&path).await.is_none());
    }

    #[rstest]
    #[tokio::test]
    async fn unregister_wrong_id_noop() {
        let registry = SessionRegistry::new();
        let path = PathBuf::from("/proj/a");
        let id_a = session_id(1);
        registry.register(path.clone(), id_a).await;

        assert!(!registry.unregister(&session_id(2)).await);
        let found = registry.find(&path).await.unwrap();
        assert_eq!(found.session_id, id_a);
    }

    #[rstest]
    #[tokio::test]
    async fn different_paths_independent() {
        let registry = SessionRegistry::new();
        let path_a = PathBuf::from("/proj/a");
        let path_b = PathBuf::from("/proj/b");
        let id_a = session_id(1);
        let id_b = session_id(2);
        registry.register(path_a.clone(), id_a).await;
        registry.register(path_b.clone(), id_b).await;

        let found_a = registry.find(&path_a).await.unwrap();
        let found_b = registry.find(&path_b).await.unwrap();
        assert_eq!(found_a.session_id, id_a);
        assert_eq!(found_b.session_id, id_b);
    }

    // ===========
    // concurrency
    // ===========

    #[rstest]
    #[tokio::test]
    async fn concurrent_register() {
        let registry = Arc::new(SessionRegistry::new());
        let path = PathBuf::from("/proj/concurrent");
        let barrier = Arc::new(tokio::sync::Barrier::new(10));

        let mut tasks = Vec::new();
        for n in 0..10u8 {
            let registry = Arc::clone(&registry);
            let path = path.clone();
            let barrier = Arc::clone(&barrier);
            tasks.push(tokio::spawn(async move {
                let id = session_id(n);
                barrier.wait().await;
                let (_rx, handle) = registry.register(path, id).await;
                handle
            }));
        }

        for (n, task) in tasks.into_iter().enumerate() {
            let handle = task.await.unwrap();
            assert_eq!(handle.session_id, session_id(n as u8));
        }

        // All 10 sessions are registered and findable.
        for n in 0..10u8 {
            assert!(
                registry.find_by_session_id(&session_id(n)).await.is_some(),
                "session {n} missing after concurrent register"
            );
        }
    }
}
