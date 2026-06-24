/**
 * Centralized error and warning text emitted by the hashline edit tool.
 * Consolidating these as named constants makes them easy to audit and
 * keeps wording stable across the rendering paths that surface them.
 */

// ─── Error messages ──────────────────────────────────────────────────

/**
 * Error when a section has no snapshot tag at all.
 */
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
// ─── Warning messages ────────────────────────────────────────────────

/**
 * Warning when head/tail inserts are applied to a file whose tag is stale.
 * Head/tail position is content-independent so the insert applies safely.
 */
// ─── Block resolution messages ────────────────────────────────────────

export const BLOCK_RESOLVER_UNAVAILABLE =
  "Block editing is not available (no block resolver configured). Use 'old_range' with an explicit line range instead.";

export function blockUnresolvedMessage(line: number): string {
  return (
    `Could not resolve a syntactic block beginning on line ${line}. ` +
    "The language may be unsupported, the line may be blank or a closing delimiter, " +
    'or the block may not parse. Use "old_range" with an explicit line range instead.'
  );
}
