/**
 * Apply a parsed list of {@link Edit}s to a text body.
 *
 * Pure function — no filesystem, no tag validation. Handles insert ordering
 * so that deletes don't shift insert anchors (all anchors are pre-edit line
 * numbers). Deletes are applied back-to-front; inserts within each anchor
 * line preserve order (before-anchor → replacement → after-anchor).
 */

import type { Anchor, ApplyResult, Cursor, Edit } from "./types.js";

// ─── Internal types ──────────────────────────────────────────────────

type InsertEdit = Extract<Edit, { kind: "insert" }>;
type DeleteEdit = Extract<Edit, { kind: "delete" }>;
type AppliedEdit = InsertEdit | DeleteEdit;

interface IndexedEdit {
  edit: AppliedEdit;
  idx: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isReplacementInsert(
  edit: Edit,
): edit is InsertEdit & { mode: "replacement" } {
  return edit.kind === "insert" && edit.mode === "replacement";
}

/** Clone a cursor so edits own their anchor references. */
function cloneCursor(cursor: Cursor): Cursor {
  if (cursor.kind === "before_anchor" || cursor.kind === "after_anchor") {
    return { kind: cursor.kind, anchor: { line: cursor.anchor.line } };
  }
  return cursor;
}

/** Clone an edit so the applier owns its own copies. */
function cloneAppliedEdit(edit: AppliedEdit, index: number): AppliedEdit {
  if (edit.kind === "delete") {
    return { ...edit, anchor: { ...edit.anchor }, index };
  }
  return { ...edit, cursor: cloneCursor(edit.cursor), index };
}

/** Collect anchors from an edit for line-bound validation. */
function getEditAnchors(edit: AppliedEdit): Anchor[] {
  if (edit.kind === "delete") {
    return [edit.anchor];
  }
  if (
    edit.cursor.kind === "before_anchor" ||
    edit.cursor.kind === "after_anchor"
  ) {
    return [edit.cursor.anchor];
  }
  return [];
}

// ─── Validation ──────────────────────────────────────────────────────

/**
 * Verify every anchored edit points at an existing line.
 * bof/eof inserts are exempt — they don't target a line number.
 */
function validateLineBounds(edits: AppliedEdit[], totalLines: number): void {
  for (const edit of edits) {
    for (const anchor of getEditAnchors(edit)) {
      if (anchor.line < 1 || anchor.line > totalLines) {
        throw new Error(
          `Line ${anchor.line} does not exist (file has ${totalLines} lines)`,
        );
      }
    }
  }
}

// ─── Insert-at-boundary helpers ──────────────────────────────────────

/**
 * Insert lines at the start of the file.
 * Handles the edge case where the file is just `[""]` (empty).
 */
function insertAtStart(
  fileLines: string[],
  lines: string[],
): number | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  if (fileLines.length === 1 && fileLines[0] === "") {
    fileLines.splice(0, 1, ...lines);
    return 1;
  }
  fileLines.splice(0, 0, ...lines);
  return 1;
}

/**
 * Insert lines at the end of the file.
 * Handles the trailing-newline convention (last element is `""`).
 * Returns the first changed line (1-indexed).
 */
function insertAtEnd(fileLines: string[], lines: string[]): number | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  if (fileLines.length === 1 && fileLines[0] === "") {
    fileLines.splice(0, 1, ...lines);
    return 1;
  }
  // If file ends with `""` (trailing newline), insert before it.
  const insertIdx =
    fileLines.length > 0 && fileLines[fileLines.length - 1] === ""
      ? fileLines.length - 1
      : fileLines.length;
  fileLines.splice(insertIdx, 0, ...lines);
  return insertIdx + 1;
}

// ─── Bucket edits by anchor line ─────────────────────────────────────

function bucketByLine(edits: IndexedEdit[]): Map<number, IndexedEdit[]> {
  const byLine = new Map<number, IndexedEdit[]>();
  for (const entry of edits) {
    const line =
      entry.edit.kind === "delete"
        ? entry.edit.anchor.line
        : entry.edit.cursor.kind === "before_anchor" ||
            entry.edit.cursor.kind === "after_anchor"
          ? entry.edit.cursor.anchor.line
          : 0; // won't be used (bof/eof are partitioned out)
    const bucket = byLine.get(line);
    if (bucket) {
      bucket.push(entry);
    } else {
      byLine.set(line, [entry]);
    }
  }
  return byLine;
}

// ─── Core applier ────────────────────────────────────────────────────

/**
 * Apply a parsed list of edits to a text body.
 *
 * All line numbers are relative to the pre-edit file. Deletes are applied
 * back-to-front so earlier indices stay valid; inserts within a single anchor
 * line are ordered: before-anchor → replacement → current line (if not
 * deleted) → after-anchor.
 *
 * Throws if a block edit reaches here unresolved (should have been expanded
 * by `resolveBlockEdits` before calling).
 */
export function applyEdits(text: string, edits: readonly Edit[]): ApplyResult {
  if (edits.length === 0) {
    return { text };
  }
  // Block edits must be resolved before reaching the applier.
  for (const edit of edits) {
    if (edit.kind === "block") {
      throw new Error(
        "internal error: unresolved `replace block` edit reached the applier (resolveBlockEdits was not run).",
      );
    }
  }

  const fileLines = text.split("\n");
  let firstChangedLine: number | undefined;

  const track = (line: number) => {
    if (firstChangedLine === undefined || line < firstChangedLine) {
      firstChangedLine = line;
    }
  };

  // Clone edits so we own the objects.
  const cloned = (edits as readonly AppliedEdit[]).map((edit, index) =>
    cloneAppliedEdit(edit, index),
  );

  // Partition: bof, eof, anchored.
  const bofLines: string[] = [];
  const eofLines: string[] = [];
  const anchorEdits: IndexedEdit[] = [];

  for (const edit of cloned) {
    if (edit.kind === "insert" && edit.cursor.kind === "bof") {
      bofLines.push(edit.text);
    } else if (edit.kind === "insert" && edit.cursor.kind === "eof") {
      eofLines.push(edit.text);
    } else {
      anchorEdits.push({ edit, idx: edit.index });
    }
  }

  // Validate anchored edits point at existing lines.
  validateLineBounds(
    anchorEdits.map((e) => e.edit),
    fileLines.length,
  );

  // Group anchored edits by target line, process back-to-front.
  const byLine = bucketByLine(anchorEdits);

  for (const line of [...byLine.keys()].sort((a, b) => b - a)) {
    const bucket = byLine.get(line);
    if (!bucket) {
      continue;
    }
    // Stable sort by original edit index within the bucket.
    bucket.sort((a, b) => a.idx - b.idx);

    const before: string[] = [];
    const replacement: string[] = [];
    const after: string[] = [];
    let deleted = false;

    for (const { edit } of bucket) {
      if (isReplacementInsert(edit)) {
        replacement.push(edit.text);
      } else if (
        edit.kind === "insert" &&
        edit.cursor.kind === "after_anchor"
      ) {
        after.push(edit.text);
      } else if (edit.kind === "insert") {
        before.push(edit.text);
      } else if (edit.kind === "delete") {
        deleted = true;
      }
    }

    // No-op bucket (shouldn't happen after validation).
    if (
      before.length === 0 &&
      replacement.length === 0 &&
      after.length === 0 &&
      !deleted
    ) {
      continue;
    }

    const idx = line - 1;
    const currentLine = fileLines[idx] ?? "";

    const newContent = deleted
      ? [...before, ...replacement, ...after]
      : [...before, ...replacement, currentLine, ...after];

    fileLines.splice(idx, 1, ...newContent);
    track(line);
  }

  // Apply boundary inserts.
  const bofChanged = insertAtStart(fileLines, bofLines);
  if (bofChanged !== undefined) {
    track(bofChanged);
  }

  const eofChanged = insertAtEnd(fileLines, eofLines);
  if (eofChanged !== undefined) {
    track(eofChanged);
  }

  return { text: fileLines.join("\n"), firstChangedLine };
}
