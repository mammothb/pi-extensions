/**
 * Block edit resolution — expands `kind: "block"` edits into concrete
 * inserts and deletes before they reach the applier.
 */

import {
  BLOCK_RESOLVER_UNAVAILABLE,
  blockUnresolvedMessage,
} from "./messages.js";
import type { BlockResolver, Edit } from "./types.js";

/**
 * Returns `true` when any edit in the list is a deferred block edit
 * (`replace block N:` / `delete block N`).
 */
export function hasBlockEdit(edits: readonly Edit[]): boolean {
  return edits.some((e) => e.kind === "block");
}

/**
 * Expand every `kind: "block"` edit into concrete insert+delete edits.
 *
 * Non-block edits pass through unchanged. Synthesized edits get fresh
 * sequential `index` values — the applier re-derives them anyway.
 *
 * @param onUnresolved  `"throw"` (default) raises an error; `"drop"` silently
 *   skips the edit.
 */
export function resolveBlockEdits(
  edits: readonly Edit[],
  text: string,
  path: string,
  resolver: BlockResolver | undefined,
  options?: { onUnresolved?: "throw" | "drop" },
): readonly Edit[] {
  // Fast path — no block edits to resolve
  if (!hasBlockEdit(edits)) {
    return edits;
  }

  const onUnresolved = options?.onUnresolved ?? "throw";
  const resolved: Edit[] = [];
  let nextIndex = 0;

  for (const edit of edits) {
    if (edit.kind !== "block") {
      // Pass through non-block edits, renumber index
      resolved.push({ ...edit, index: nextIndex++ });
      continue;
    }

    // Block edit — needs a resolver
    if (!resolver) {
      if (onUnresolved === "drop") {
        continue;
      }
      throw new Error(BLOCK_RESOLVER_UNAVAILABLE);
    }

    const span = resolver({
      path,
      text,
      line: edit.anchor.line,
    });

    if (span === null) {
      if (onUnresolved === "drop") {
        continue;
      }
      throw new Error(blockUnresolvedMessage(edit.anchor.line));
    }

    // Emit one replacement insert per payload row before span.start
    for (const payload of edit.payloads) {
      resolved.push({
        kind: "insert",
        cursor: {
          kind: "before_anchor",
          anchor: { line: span.start },
        },
        text: payload,
        lineNum: edit.lineNum,
        index: nextIndex++,
        mode: "replacement",
      });
    }

    // Emit one delete per line across [span.start, span.end]
    for (let line = span.start; line <= span.end; line++) {
      resolved.push({
        kind: "delete",
        anchor: { line },
        lineNum: edit.lineNum,
        index: nextIndex++,
      });
    }
  }

  return resolved;
}
