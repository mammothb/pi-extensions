use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{RwLock, mpsc};

use crate::types::{EventType, SessionId};

/// Session registry keyed by project_path.
/// Multiple sessions per path allowed; routing picks newest.
pub struct SessionRegistry {
    /// project_path -> sequence -> SessionHandle
    sessions: RwLock<HashMap<PathBuf, BTreeMap<u64, SessionHandle>>>,
    /// session_id -> (project_path, sequence) - reverse index for O(1)
    /// unregister
    index: RwLock<HashMap<SessionId, (PathBuf, u64)>>,
    /// Monotonic sequence guaranteeing a unique, newest-first key per
    /// registration (unlike Instant, which can collide within one tick).
    next_seq: AtomicU64,
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

/// Normalize a project path to a stable registry key, resolving symlinks,
/// dot segments, and trailing separators so equivalent spellings of one
/// project share a single key. Applied at both registration and lookup
/// boundaries. Falls back to the path as given when it cannot be resolved
/// (e.g. not yet created), mirroring mm-cli's `fs_err::canonicalize(...)
/// .ok()` fallback convention.
fn normalize_project_path(path: &Path) -> PathBuf {
    fs_err::canonicalize(path)
        .ok()
        .unwrap_or_else(|| path.to_path_buf())
}

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
            next_seq: AtomicU64::new(0),
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
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);

        // Same normalization as find, so equivalent spellings of one project
        // (trailing separator, dot segments, symlink) share a registry key.
        let project_path = normalize_project_path(&project_path);

        // Deduplicate: if this session_id is already registered, drop the old
        // entry from both maps first. Otherwise the old handle is orphaned -
        // unreachable via unregister and stale via find on its project path.
        let mut index = self.index.write().await;
        let existing = index.remove(&session_id);
        let mut sessions = self.sessions.write().await;
        if let Some((old_path, old_seq)) = existing
            && let Some(map) = sessions.get_mut(&old_path)
        {
            map.remove(&old_seq);
            if map.is_empty() {
                sessions.remove(&old_path);
            }
        }
        sessions
            .entry(project_path.clone())
            .or_default()
            .insert(seq, handle.clone());
        drop(sessions);
        index.insert(session_id, (project_path, seq));
        (rx, handle)
    }

    /// Removes session by id. Returns true if removed, false if not found.
    pub async fn unregister(&self, session_id: &SessionId) -> bool {
        let (project_path, seq) = match self.index.write().await.remove(session_id) {
            Some(entry) => entry,
            None => return false,
        };

        let mut sessions = self.sessions.write().await;
        if let Some(map) = sessions.get_mut(&project_path) {
            map.remove(&seq);
            if map.is_empty() {
                sessions.remove(&project_path);
            }
        }
        true
    }
    /// Find the newest session for a project path.
    /// The lookup path is canonicalized exactly as at registration, so
    /// equivalent spellings match.
    pub async fn find(&self, project_path: &Path) -> Option<SessionHandle> {
        let key = normalize_project_path(project_path);
        self.sessions
            .read()
            .await
            .get(&key)
            .and_then(|map| map.last_key_value())
            .map(|(_, handle)| handle.clone())
    }

    pub async fn find_by_session_id(&self, session_id: &SessionId) -> Option<SessionHandle> {
        let index = self.index.read().await;
        let (project_path, seq) = index.get(session_id)?;
        let sessions = self.sessions.read().await;
        sessions.get(project_path)?.get(seq).cloned()
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
    async fn duplicate_register_replaces_old() {
        let registry = SessionRegistry::new();
        let path = PathBuf::from("/proj/a");
        let id = session_id(1);

        let (mut older_rx, _) = registry.register(path.clone(), id).await;
        let (_, newer) = registry.register(path.clone(), id).await;
        assert_eq!(newer.session_id, id);

        // Only the newest handle is discoverable via find.
        let found = registry.find(&path).await.unwrap();
        assert_eq!(found.session_id, id);

        // The replaced handle's sender is dropped, so its channel is closed.
        assert!(matches!(
            older_rx.try_recv(),
            Err(mpsc::error::TryRecvError::Disconnected)
        ));

        // A single unregister removes the registration.
        assert!(registry.unregister(&id).await);
        assert!(registry.find(&path).await.is_none());
    }

    #[rstest]
    #[tokio::test]
    async fn duplicate_register_cleans_old_path() {
        let registry = SessionRegistry::new();
        let path_a = PathBuf::from("/proj/a");
        let path_b = PathBuf::from("/proj/b");
        let id = session_id(1);

        registry.register(path_a.clone(), id).await;
        registry.register(path_b.clone(), id).await;

        // Old project no longer sees the session; new project does.
        assert!(registry.find(&path_a).await.is_none());
        let found = registry.find(&path_b).await.unwrap();
        assert_eq!(found.session_id, id);

        // Single unregister removes it everywhere.
        assert!(registry.unregister(&id).await);
        assert!(registry.find(&path_b).await.is_none());
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

    // =============
    // normalization
    // =============

    #[rstest]
    #[tokio::test]
    async fn find_normalizes_trailing_separator() {
        let registry = SessionRegistry::new();
        let dir = tempfile::tempdir().unwrap();
        let id = session_id(1);
        registry.register(dir.path().to_path_buf(), id).await;

        let trailing = PathBuf::from(format!("{}/", dir.path().display()));
        let found = registry.find(&trailing).await.unwrap();
        assert_eq!(found.session_id, id);
    }

    #[rstest]
    #[tokio::test]
    async fn find_normalizes_dot_segments() {
        let registry = SessionRegistry::new();
        let dir = tempfile::tempdir().unwrap();
        let deep = dir.path().join("sub").join("deep");
        fs_err::create_dir_all(&deep).unwrap();
        let id = session_id(1);
        registry.register(deep.clone(), id).await;

        // sub/./deep and sub/deep/../deep both resolve to sub/deep.
        let dot = dir.path().join("sub").join(".").join("deep");
        let back = dir.path().join("sub").join("deep").join("..").join("deep");
        assert_eq!(registry.find(&dot).await.unwrap().session_id, id);
        assert_eq!(registry.find(&back).await.unwrap().session_id, id);
    }

    #[cfg(unix)]
    #[rstest]
    #[tokio::test]
    #[allow(clippy::disallowed_methods)] // tests may create symlinks
    async fn find_normalizes_symlinked_path() {
        let registry = SessionRegistry::new();
        let dir = tempfile::tempdir().unwrap();
        let id = session_id(1);
        registry.register(dir.path().to_path_buf(), id).await;

        let link = dir.path().join("link");
        std::os::unix::fs::symlink(dir.path(), &link).unwrap();
        let found = registry.find(&link).await.unwrap();
        assert_eq!(found.session_id, id);
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
