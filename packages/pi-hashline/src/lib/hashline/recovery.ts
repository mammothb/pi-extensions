/**
 * Stale-tag recovery: attempts to salvage edits when the file's content
 * hash no longer matches the tag the edit was authored against.
 *
 * Two strategies, tried in order:
 *
 * 1. **Structured-patch 3-way merge**: apply edits to cached snapshot,
 *    create a structured patch, then apply that patch to the live content.
 *    Handles most drift (unrelated lines changed, formatters, etc.).
 *
 * 2. **Session-chain replay**: when the structured merge refuses but the
 *    anchors still point at identical content, apply the edits directly to
 *    the live file. Less certain — the model must verify the result.
 */

import { applyPatch, structuredPatch } from "diff";
import { applyEdits } from "./apply.js";
import {
  RECOVERY_EXTERNAL_WARNING,
  RECOVERY_SESSION_CHAIN_WARNING,
  RECOVERY_SESSION_REPLAY_WARNING,
} from "./messages.js";
import type { SnapshotStore } from "./snapshots.js";
import type { Edit } from "./types.js";

// ─── Recovery result ─────────────────────────────────────────────────

export interface RecoveryResult {
  /** Recovered text (normalized LF). */
  text: string;
  /** Human-readable warning describing what recovery did. */
  warning: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Check whether all anchor lines at the same positions in `live` still
 * have the same content as in `snapshot`. If any anchor moved or changed,
 * direct replay is unsafe.
 */
function anchorsStillMatch(
  snapshotText: string,
  liveText: string,
  anchorLines: readonly number[],
): boolean {
  const snapshotLines = snapshotText.split("\n");
  const liveLines = liveText.split("\n");

  for (const line of anchorLines) {
    const idx = line - 1;
    if (idx >= snapshotLines.length || idx >= liveLines.length) {
      return false;
    }
    if (snapshotLines[idx] !== liveLines[idx]) {
      return false;
    }
  }
  return true;
}

// ─── Recovery ────────────────────────────────────────────────────────

/**
 * Attempt to recover from a stale tag.
 *
 * @param snapshots — the session's snapshot store
 * @param path — absolute file path
 * @param currentText — normalized LF content of the live file
 * @param fileHash — the stale tag from the edit's header
 * @param edits — the parsed edits to apply
 * @param anchorLines — anchor lines targeted by the edits (1-indexed, deduplicated)
 * @returns RecoveryResult on success, null if recovery is impossible
 */
export function tryRecover(
  snapshots: SnapshotStore,
  path: string,
  currentText: string,
  fileHash: string,
  edits: readonly Edit[],
  anchorLines: readonly number[],
): RecoveryResult | null {
  // 1. Look up the snapshot the edit was authored against.
  const snapshot = snapshots.byHash(path, fileHash);
  if (snapshot === null) {
    return null; // hash never recorded — agent forged it or from another session
  }

  // 2. Apply edits to the snapshot text to get the would-be result.
  const { text: wouldBeResult } = applyEdits(snapshot.text, edits);

  // 3. Create a structured patch from snapshot → would-be result.
  const patch = structuredPatch(
    path,
    path,
    snapshot.text,
    wouldBeResult,
    undefined, // oldHeader
    undefined, // newHeader
    { context: 3 },
  );

  // 4. Apply the patch to the current live text.
  const merged = applyPatch(currentText, patch);

  // Strategy 1: structured-patch 3-way merge succeeded.
  if (merged !== false && merged !== currentText) {
    const head = snapshots.head(path);
    const driftIsExternal = head !== null && head.hash === snapshot.hash;
    return {
      text: merged,
      warning: driftIsExternal
        ? RECOVERY_EXTERNAL_WARNING
        : RECOVERY_SESSION_CHAIN_WARNING,
    };
  }

  // 5. Strategy 2: direct anchor-based replay.
  // Structured merge failed (or produced no change), but if the anchor
  // lines still match between snapshot and live, apply edits directly.
  // This handles both external changes and session-chain when context
  // diverged but anchor content is identical.
  if (anchorLines.length > 0) {
    if (anchorsStillMatch(snapshot.text, currentText, anchorLines)) {
      const { text: replayed } = applyEdits(currentText, edits);
      if (replayed !== currentText) {
        const head = snapshots.head(path);
        const driftIsExternal = head !== null && head.hash === snapshot.hash;
        return {
          text: replayed,
          warning: driftIsExternal
            ? RECOVERY_EXTERNAL_WARNING
            : RECOVERY_SESSION_REPLAY_WARNING,
        };
      }
    }
  }

  // Recovery impossible.
  return null;
}
