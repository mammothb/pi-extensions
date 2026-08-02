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
}
