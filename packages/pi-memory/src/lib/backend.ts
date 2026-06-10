// ── Shared types ────────────────────────────────────────────────

/** Scope of a memory entry: per-project or cross-project global. */
export type MemoryScope = "project" | "global";

/** An entry in the project index registry. */
export interface IndexEntry {
  path: string;
  lastAccess: string;
}

/** A single memory entry returned by a recall operation. */
export interface RecallEntry {
  key: string;
  value: string;
  /** Which scope this entry came from (used by tools for display labels). */
  scope: MemoryScope;
  /** Relevance score when recall was a keyword query. Undefined for list mode. */
  score?: number;
}

/** Options controlling how recall searches and filters memory. */
export interface RecallOptions {
  /** Keyword query for scored search. */
  query?: string;
  /** Return all entries instead of searching. */
  list?: boolean;
  /** Filter results to keys starting with this prefix. */
  namespace?: string;
  /** Maximum number of results to return (for scored search). */
  limit?: number;
}

/** Parameters for storing a memory entry. */
export interface RetainParams {
  scope: MemoryScope;
  /** Current working directory (backend may hash internally for project isolation). */
  cwd: string;
  key: string;
  value: string;
  /** Optional TTL in seconds. After expiry the entry is excluded from recall. */
  ttlSeconds?: number;
}

// ── The interface ─────────────────────────────────────────────

/**
 * Semantic backend for the pi-memory system.
 *
 * Tools (retain, recall, reflect, compact_memory, memory_edit) are thin
 * adapters that call these methods. The backend owns storage, search, TTL
 * expiry, and project/global merging.
 *
 * All methods return Promises so backends can be backed by external
 * processes (IPC, HTTP), a database, or the local filesystem.
 */
export interface MemoryBackend {
  /** Store a memory entry. Overwrites if key already exists. */
  retain(params: RetainParams): Promise<void>;

  /**
   * Recall memories.
   *
   * Returns entries merged from project + global scope (project overrides
   * global on key collision). Expired entries are excluded. When a query is
   * provided, results are scored and sorted by relevance.
   */
  recall(params: {
    cwd: string;
    options: RecallOptions;
  }): Promise<RecallEntry[]>;

  /** Delete a memory entry. No-op if key doesn't exist. */
  forget(params: {
    scope: MemoryScope;
    cwd: string;
    key: string;
  }): Promise<void>;

  /** Rename a memory key, preserving value and TTL. */
  rename(params: {
    scope: MemoryScope;
    cwd: string;
    oldKey: string;
    newKey: string;
  }): Promise<void>;

  /** Return the full project index registry. */
  getIndex(): Promise<Record<string, IndexEntry>>;

  /**
   * Record a project access in the index.
   * `cwd` is raw — the backend hashes internally if needed.
   */
  upsertIndex(cwd: string, entry: IndexEntry): Promise<void>;
}
