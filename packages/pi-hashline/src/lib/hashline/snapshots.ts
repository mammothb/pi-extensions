/**
 * Per-session snapshot store used by recovery and the patcher to bind
 * hashline section tags to the exact file content that minted them.
 *
 * A section tag is a content-derived hash of the *whole file* (see
 * {@link computeFileHash}). Any read of byte-identical content mints the
 * same tag, so reads of one file state fuse onto one anchor and a follow-up
 * edit anchored at any line validates whenever the live file still hashes
 * to it.
 *
 * Producers (typically `read` / `grep` / `write` tools) call
 * {@link SnapshotStore.record} with the full normalized text they observed.
 * The store hashes it, dedups against the per-path history, and returns the
 * tag. Consumers (the patcher) resolve a stale tag back to the recorded
 * full text via {@link SnapshotStore.byHash} and 3-way-merge the would-be
 * edit onto the live content.
 */

import { computeFileHash } from "./format.js";

/**
 * One full-file version observed at a point in time. The tag the model sees
 * is {@link Snapshot.hash}; recovery replays edits against
 * {@link Snapshot.text}.
 */
export interface Snapshot {
  /** Canonical path this version belongs to. */
  readonly path: string;
  /** Full normalized (LF, no BOM) file text as observed. */
  readonly text: string;
  /** Content-derived tag for {@link Snapshot.text} (see {@link computeFileHash}). */
  readonly hash: string;
  /** Timestamp (ms since epoch) the version was recorded. */
  recordedAt: number;
}

/**
 * Storage seam for full-file version snapshots. The patcher calls
 * {@link head} for the latest version of a path and {@link byHash} when it
 * needs the specific historical version a section's stale tag names.
 */
export abstract class SnapshotStore {
  /** Most-recently recorded version for `path`, or `null` if none. */
  abstract head(path: string): Snapshot | null;

  /** Recorded version for `path` whose tag equals `hash`, or `null`. */
  abstract byHash(path: string, hash: string): Snapshot | null;

  /** Record the full normalized text of `path` and return its content tag. */
  abstract record(path: string, fullText: string): string;

  /** Drop the version history for a single path. */
  abstract invalidate(path: string): void;

  /** Drop every version history. */
  abstract clear(): void;
}

const DEFAULT_MAX_PATHS = 30;
const DEFAULT_MAX_VERSIONS_PER_PATH = 4;
const DEFAULT_MAX_SNAPSHOT_BYTES = 1_048_576; // 1 MiB

export interface InMemorySnapshotStoreOptions {
  /** Maximum number of distinct paths tracked at once (default 30). */
  maxPaths?: number;
  /** Maximum full-file versions retained per path (default 4). Oldest dropped first. */
  maxVersionsPerPath?: number;
  /**
   * Maximum size in bytes of a single snapshot's normalized text (default 1 MiB).
   * Files exceeding this limit still get a hash tag (so tag validation works) but
   * their full text is not stored — stale-tag recovery will not be available.
   */
  maxSnapshotBytes?: number;
}

/**
 * In-memory {@link SnapshotStore} with a simple LRU eviction policy.
 * Per-path history is a short ring of full-file versions (oldest dropped
 * first); per-session path tracking is LRU-bounded so cold paths age out
 * automatically.
 *
 * Recording byte-identical content again refreshes recency and reuses the
 * existing tag (read fusion); recording new content unshifts a fresh
 * version onto the front of the path history.
 */
export class InMemorySnapshotStore extends SnapshotStore {
  // Map preserves insertion order — we use that for LRU eviction.
  // Each value is a list of snapshots, newest first.
  readonly #versions = new Map<string, Snapshot[]>();
  readonly #maxPaths: number;
  readonly #maxVersionsPerPath: number;
  readonly #maxSnapshotBytes: number;

  constructor(options: InMemorySnapshotStoreOptions = {}) {
    super();
    this.#maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
    this.#maxVersionsPerPath =
      options.maxVersionsPerPath ?? DEFAULT_MAX_VERSIONS_PER_PATH;
    this.#maxSnapshotBytes =
      options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
  }

  head(path: string): Snapshot | null {
    return this.#versions.get(path)?.[0] ?? null;
  }

  byHash(path: string, hash: string): Snapshot | null {
    const history = this.#versions.get(path);
    return history?.find((version) => version.hash === hash) ?? null;
  }

  record(path: string, fullText: string): string {
    const hash = computeFileHash(fullText);

    // Skip storage for files exceeding the size cap — hash is still returned
    // so tag validation works, but recovery won't be available.
    if (fullText.length > this.#maxSnapshotBytes) {
      return hash;
    }

    // Refresh LRU recency: delete-then-set moves path to end of insertion order.
    const history = this.#versions.get(path);
    if (history) {
      this.#versions.delete(path);

      const existing = history.find((version) => version.hash === hash);
      if (existing) {
        // Same content state observed again: refresh recency and promote to
        // head (it is the current file content), then reuse the tag.
        existing.recordedAt = Date.now();
        const filtered = history.filter((version) => version !== existing);
        this.#versions.set(path, [existing, ...filtered]);
        this.#evictPathsIfNeeded();
        return hash;
      }

      // New content: prepend to history, cap versions per path.
      const snapshot: Snapshot = {
        path,
        text: fullText,
        hash,
        recordedAt: Date.now(),
      };
      this.#versions.set(
        path,
        [snapshot, ...history].slice(0, this.#maxVersionsPerPath),
      );
      this.#evictPathsIfNeeded();
      return hash;
    }

    // First version for this path.
    const snapshot: Snapshot = {
      path,
      text: fullText,
      hash,
      recordedAt: Date.now(),
    };
    this.#versions.set(path, [snapshot]);
    this.#evictPathsIfNeeded();
    return hash;
  }

  invalidate(path: string): void {
    this.#versions.delete(path);
  }

  clear(): void {
    this.#versions.clear();
  }

  /** Evict the least-recently-used path when the path cap is exceeded. */
  #evictPathsIfNeeded(): void {
    while (this.#versions.size > this.#maxPaths) {
      // Map keys iterate in insertion order — first key is LRU.
      const firstKey = this.#versions.keys().next().value;
      if (firstKey !== undefined) {
        this.#versions.delete(firstKey);
      }
    }
  }
}
