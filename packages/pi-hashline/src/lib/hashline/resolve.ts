/**
 * Hash anchor resolution for JSON-format edits.
 *
 * Maps hash-anchored `old_range` entries back to line numbers using a
 * precomputed per-line hash array. Detects stale anchors (hash not found),
 * ambiguous anchors, boundary duplication (LLM accidentally duplicating
 * adjacent lines), and bare hash prefixes (LLM copying HASH│ prefix
 * from read output into edit content).
 */

import { LINE_HASH_LENGTH } from "./hash.js";

// ─── Types ────────────────────────────────────────────────────────────

/** A resolved anchor: the line number and its content hash. */
export interface ResolvedAnchor {
  line: number;
  hash: string;
}

/** A fully resolved edit with concrete 1-indexed line numbers. */
export interface ResolvedHashlineEdit {
  old_range: [ResolvedAnchor, ResolvedAnchor];
  new_lines: string[];
}

/** Raw edit as received in the JSON format (string=hash, number=line). */
export interface HashlineToolEdit {
  old_range: [string | number, string | number];
  new_lines: string[];
}

/** A hash anchor that could not be resolved. */
export interface HashMismatch {
  anchor: string;
  kind: "not_found" | "ambiguous";
  candidates?: number[];
}

/** Metadata for a boundary duplication, resolved to a warning post-apply. */
export interface BoundaryDuplicationWarning {
  kind: "trailing" | "leading";
  /** The surviving line's content (unchanged by the edit). */
  survivingLineContent: string;
  /** The line in new_lines that duplicates the survivor. */
  replacementLineContent: string;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Resolve hash-anchored edits to concrete line numbers.
 *
 * For each edit, both anchors in `old_range` are resolved against
 * `fileHashes`. Number anchors pass through as line numbers (backward
 * compat with Phase 1). String anchors are looked up by hash.
 *
 * Also detects boundary duplications (trailing/leading line matches)
 * and bare hash prefixes in new_lines content.
 *
 * Mismatches are collected — the caller formats the error.
 */
export function resolveHashlineEdits(
  edits: HashlineToolEdit[],
  fileHashes: string[],
  fileLines: string[],
): {
  resolved: ResolvedHashlineEdit[];
  mismatches: HashMismatch[];
  boundaryWarnings: BoundaryDuplicationWarning[];
} {
  const resolved: ResolvedHashlineEdit[] = [];
  const mismatches: HashMismatch[] = [];
  const boundaryWarnings: BoundaryDuplicationWarning[] = [];

  for (const edit of edits) {
    const startResolved = resolveAnchor(edit.old_range[0], fileHashes);
    const endResolved = resolveAnchor(edit.old_range[1], fileHashes);

    if (isMismatch(startResolved)) {
      mismatches.push(startResolved);
    }
    if (isMismatch(endResolved)) {
      mismatches.push(endResolved);
    }

    if (isMismatch(startResolved) || isMismatch(endResolved)) {
      continue;
    }

    const start = startResolved;
    const end = endResolved;

    if (start.line > end.line) {
      throw new Error(
        `[E_BAD_OP] Range start line ${start.line} must be <= end line ${end.line} (anchors "${start.hash}" and "${end.hash}").`,
      );
    }

    // Boundary duplication detection (Phase 3)
    detectBoundaryDuplication(
      edit,
      start.line,
      end.line,
      fileLines,
      boundaryWarnings,
    );

    resolved.push({
      old_range: [
        { line: start.line, hash: start.hash },
        { line: end.line, hash: end.hash },
      ],
      new_lines: edit.new_lines,
    });
  }

  return { resolved, mismatches, boundaryWarnings };
}

/**
 * Reject any `new_lines` entry that starts with a bare hash prefix
 * (4 hex chars + │). This catches the LLM copying `HASH│content`
 * from read output into edit content.
 */
export function assertNoBareHashPrefixLines(
  edits: HashlineToolEdit[],
  fileHashes: string[],
): string[] {
  interface Suspect {
    line: string;
    hash: string;
    editIndex: number;
    lineIndex: number;
  }
  const suspects: Array<Suspect> = [];
  const BARE_PREFIX_RE = new RegExp(`^([0-9a-f]{${LINE_HASH_LENGTH}})│`);

  for (let editIndex = 0; editIndex < edits.length; editIndex++) {
    const edit = edits[editIndex] as HashlineToolEdit;
    for (let lineIndex = 0; lineIndex < edit.new_lines.length; lineIndex++) {
      const line = edit.new_lines[lineIndex] as string;
      const match = line.match(BARE_PREFIX_RE);
      if (match) {
        suspects.push({ line, hash: match[1] as string, editIndex, lineIndex });
      }
    }
  }

  if (suspects.length === 0) {
    return [];
  }

  const fileHashSet = new Set(fileHashes);
  const matched = suspects.filter((s) => fileHashSet.has(s.hash));
  const matchedCount = matched.length;
  const example = suspects[0] as Suspect;
  const exampleLine = `${example.hash}│${example.line}`;

  const linesHint =
    matchedCount === 0
      ? "None match file line hashes."
      : `${matchedCount} match file line hashes — likely a copied anchor.`;

  throw new Error(
    `[E_BARE_HASH_PREFIX] ${suspects.length} edit line(s) start with a hash-like prefix (e.g. ${JSON.stringify(exampleLine)}). ${linesHint} Use literal file content in "new_lines" — never paste HASH│content from read output.`,
  );
}

/**
 * Format warnings for boundary duplications using post-edit hashes.
 * Called after the edit is applied so the surviving line's hash is accurate.
 */
export function formatBoundaryWarnings(
  boundaryWarnings: BoundaryDuplicationWarning[],
  resultLines: string[],
  resultHashes: string[],
): string[] {
  const warnings: string[] = [];
  for (const bw of boundaryWarnings) {
    let seen = 0;
    let matchIndex = -1;
    for (let i = 0; i < resultLines.length; i++) {
      if (resultLines[i] === bw.survivingLineContent) {
        if (seen === 0) {
          // Use the first occurrence after the edit range for trailing,
          // or the occurrence at the original position for leading.
          matchIndex = i;
        }
        seen++;
      }
    }
    if (matchIndex >= 0) {
      const hash = resultHashes[matchIndex] as string;
      if (bw.kind === "trailing") {
        warnings.push(
          `Potential boundary duplication: the last line of the replacement matches the next surviving line. ` +
            `Surviving line hash: ${hash}`,
        );
      } else {
        warnings.push(
          `Potential boundary duplication: the first line of the replacement matches the preceding surviving line. ` +
            `Surviving line hash: ${hash}`,
        );
      }
    }
  }
  return warnings;
}

/**
 * Format a human-readable error message for hash mismatches.
 * Includes fresh hashline context so the model can retry immediately.
 */
export function formatMismatchError(
  mismatches: HashMismatch[],
  fileLines: string[],
  fileHashes: string[],
): string {
  const out: string[] = [];
  const notFound = mismatches.filter((m) => m.kind === "not_found");
  const ambiguous = mismatches.filter((m) => m.kind === "ambiguous");

  const refList = notFound.map((m) => `"${m.anchor}"`).join(", ");
  if (notFound.length > 0) {
    out.push(
      `[E_STALE_ANCHOR] ${notFound.length} stale anchor${
        notFound.length > 1 ? "s" : ""
      }: ${refList}. Call read() to get fresh anchors, then copy the ${LINE_HASH_LENGTH}-character HASH from each line into your next edit call.`,
    );
  }

  if (ambiguous.length > 0) {
    if (out.length > 0) {
      out.push("");
    }
    out.push(
      `[E_AMBIGUOUS_ANCHOR] ${ambiguous.length} ambiguous anchor${
        ambiguous.length > 1 ? "s" : ""
      }. Call read() to get fresh anchors.`,
    );
    for (const m of ambiguous) {
      const sample = (m.candidates ?? []).slice(0, 5);
      const more =
        (m.candidates?.length ?? 0) > sample.length
          ? `, ... (+${(m.candidates?.length ?? 0) - sample.length} more)`
          : "";
      const lines = sample
        .map((line) => {
          const content = fileLines[line - 1] ?? "";
          return `    ${fileHashes[line - 1]}│${content}`;
        })
        .join("\n");
      out.push(
        `  Hash "${m.anchor}" matches lines ${sample.join(", ")}${more}.\n${lines}`,
      );
    }
  }

  return out.join("\n");
}

// ─── Internal helpers ──────────────────────────────────────────────────

function isMismatch(
  result: ResolvedAnchor | HashMismatch,
): result is HashMismatch {
  return "kind" in result;
}

function resolveAnchor(
  ref: string | number,
  fileHashes: string[],
): ResolvedAnchor | HashMismatch {
  // Phase 1 backward compat: number → line number
  if (typeof ref === "number") {
    if (!Number.isInteger(ref) || ref < 1 || ref > fileHashes.length) {
      return { anchor: String(ref), kind: "not_found" };
    }
    return { line: ref, hash: fileHashes[ref - 1] as string };
  }

  // Phase 2: string → hash lookup
  const hash = ref;
  if (hash.length !== LINE_HASH_LENGTH || !/^[0-9a-f]+$/.test(hash)) {
    return { anchor: hash, kind: "not_found" };
  }

  const matches: number[] = [];
  for (let i = 0; i < fileHashes.length; i++) {
    if (fileHashes[i] === hash) {
      matches.push(i + 1);
    }
  }

  if (matches.length === 0) {
    return { anchor: hash, kind: "not_found" };
  }
  if (matches.length === 1) {
    return { line: matches[0] as number, hash };
  }
  return { anchor: hash, kind: "ambiguous", candidates: matches };
}

/**
 * Check if the replacement content duplicates the line immediately after
 * the edit range (trailing) or immediately before (leading).
 * Does NOT autocorrect — only records a warning.
 */
function detectBoundaryDuplication(
  edit: HashlineToolEdit,
  startLine: number,
  endLine: number,
  fileLines: string[],
  warnings: BoundaryDuplicationWarning[],
): void {
  // Trailing: last line of new_lines === next surviving line after endLine
  const nextLine = fileLines[endLine]; // endLine is 1-indexed, no -1 for "next"
  const replacementLastLine = edit.new_lines.at(-1);
  if (
    nextLine !== undefined &&
    replacementLastLine !== undefined &&
    replacementLastLine.length > 0 &&
    replacementLastLine === nextLine
  ) {
    warnings.push({
      kind: "trailing",
      survivingLineContent: nextLine,
      replacementLineContent: replacementLastLine,
    });
  }

  // Leading: first line of new_lines === line before the edit range
  const prevLine = fileLines[startLine - 2]; // startLine is 1-indexed, -2 for "previous"
  const replacementFirstLine = edit.new_lines[0];
  if (
    prevLine !== undefined &&
    replacementFirstLine !== undefined &&
    replacementFirstLine.length > 0 &&
    replacementFirstLine === prevLine
  ) {
    warnings.push({
      kind: "leading",
      survivingLineContent: prevLine,
      replacementLineContent: replacementFirstLine,
    });
  }
}
