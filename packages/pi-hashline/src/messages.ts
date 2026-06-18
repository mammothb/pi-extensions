/**
 * Centralized error and warning text emitted by the hashline edit tool.
 * Consolidating these as named constants makes them easy to audit and
 * keeps wording stable across the rendering paths that surface them.
 */

import { HL_FILE_HASH_SEP, HL_FILE_PREFIX } from "./format";

// ─── Error messages ──────────────────────────────────────────────────

/**
 * Build a mismatch error message when the live file's hash doesn't match
 * the tag the edit was authored against.
 */
export function mismatchMessage(
  sectionPath: string,
  expectedTag: string,
  actualTag: string,
): string {
  return (
    `File "${sectionPath}" changed between read and edit (expected tag #${expectedTag}, ` +
    `live file has tag #${actualTag}). Re-read the file with the read tool to get ` +
    `the current tag and anchors, then retry the edit.`
  );
}

/**
 * Error when a section has no snapshot tag at all.
 */
export function missingTagMessage(sectionPath: string): string {
  return (
    `Missing hashline snapshot tag for edit to ${sectionPath}. Use ` +
    `\`${HL_FILE_PREFIX}${sectionPath}${HL_FILE_HASH_SEP}TAG\` from your latest read output. ` +
    `To create a new file, use the write tool.`
  );
}

/**
 * Error when the target file doesn't exist.
 */
export function nonExistentFileMessage(filePath: string): string {
  return (
    `File does not exist: "${filePath}". Use the write tool to create new files, ` +
    `then edit them with the tag returned by write.`
  );
}

/**
 * Error when the edit input doesn't start with a `¶PATH#HASH` header.
 */
export function noHeaderMessage(): string {
  return (
    `Edit input must begin with "${HL_FILE_PREFIX}PATH${HL_FILE_HASH_SEP}TAG" copied ` +
    `from the read output. Example: "${HL_FILE_PREFIX}src/foo.ts${HL_FILE_HASH_SEP}0A3" ` +
    `followed by edit operations.`
  );
}

// ─── Warning messages ────────────────────────────────────────────────

/**
 * Warning when head/tail inserts are applied to a file whose tag is stale.
 * Head/tail position is content-independent so the insert applies safely.
 */
export const HEADTAIL_DRIFT_WARNING =
  "Applied insert head/tail onto the current file content even though the " +
  "snapshot tag was stale (file changed since your read). Head/tail position " +
  "is content-independent so the insert was not rejected — re-read if the " +
  "drift was unexpected.";

/** Warning when recovery succeeds via 3-way merge on an external change. */
export const RECOVERY_EXTERNAL_WARNING =
  "Recovered from a stale file hash using a previous read snapshot (file changed externally between read and edit).";

/** Warning when recovery succeeds via replay against a newer in-session snapshot. */
export const RECOVERY_SESSION_CHAIN_WARNING =
  "Recovered from a stale file hash using an earlier in-session snapshot (the file hash advanced after a prior edit in this session).";

/** Warning when structured-patch merge refused but anchor-content gate passed. */
export const RECOVERY_SESSION_REPLAY_WARNING =
  "Recovered by replaying your edits onto the current file content — your previous edit in this session changed line(s) you re-targeted with a stale hash. Verify the diff matches your intent before continuing.";

/** Error when the hash was never recorded in the snapshot store. */
export function unrecognizedHashMessage(expectedTag: string): string {
  return (
    `Snapshot tag #${expectedTag} was not recorded in this session — it may be from a different session or fabricated. ` +
    `Re-read the file to get a current tag.`
  );
}

// ─── MismatchError ───────────────────────────────────────────────────

/** Lines of context shown around each anchor in mismatch diagnostics. */
export const MISMATCH_CONTEXT = 2;

/**
 * Custom error thrown when tag validation fails.
 * Carries anchor context so renderers can show rich diagnostics.
 */
export class MismatchError extends Error {
  /** The file path (display-relative). */
  readonly filePath: string;
  /** The tag the edit was authored against. */
  readonly expectedTag: string;
  /** The tag of the current live file. */
  readonly actualTag: string;
  /** Full text of the live file (for diagnostic rendering). */
  readonly liveText: string;
  /** Anchor lines targeted by the edit (1-indexed). */
  readonly anchorLines: readonly number[];

  constructor(
    filePath: string,
    expectedTag: string,
    actualTag: string,
    liveText: string,
    anchorLines: readonly number[],
  ) {
    super(mismatchMessage(filePath, expectedTag, actualTag));
    this.name = "MismatchError";
    this.filePath = filePath;
    this.expectedTag = expectedTag;
    this.actualTag = actualTag;
    this.liveText = liveText;
    this.anchorLines = anchorLines;
  }
}
