/**
 * Centralized error and warning text emitted by the hashline edit tool.
 * Consolidating these as named constants makes them easy to audit and
 * keeps wording stable across the rendering paths that surface them.
 */

import { HL_FILE_HASH_SEP, HL_FILE_PREFIX } from "./format.js";

// ─── Error messages ──────────────────────────────────────────────────

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

// ─── Block resolution messages ────────────────────────────────────────

export const BLOCK_RESOLVER_UNAVAILABLE =
  "`replace block N:` is not available (no block resolver configured). Use `replace N..M:` with an explicit range.";

export function blockUnresolvedMessage(line: number): string {
  return (
    `\`replace block ${line}:\` could not resolve a syntactic block beginning on line ${line}. ` +
    "The language may be unsupported, the line may be blank or a closing delimiter, " +
    "or the block may not parse. Use `replace N..M:` with an explicit range."
  );
}
