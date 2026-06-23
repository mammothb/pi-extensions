/**
 * Hashline format primitives: sigils, separators, regex fragments, and
 * display helpers. These are the single source of truth for the parser, the
 * tokenizer, the prompt, and the formal grammar.
 */

import { createHash } from "node:crypto";

import type { Cursor } from "./types.js";

/** File-section header prefix: `¶path#hash`. */
export const HL_FILE_PREFIX = "¶";

/** Payload sigil for literal body rows. */
export const HL_PAYLOAD_REPLACE = "+";

/** Hunk-header keyword for concrete line replacement. */
export const HL_REPLACE_KEYWORD = "replace";
/** Hunk-header sub-keyword: `replace block N:` resolves N to a tree-sitter block range. */
export const HL_BLOCK_KEYWORD = "block";
/** Hunk-header keyword for concrete line deletion. */
export const HL_DELETE_KEYWORD = "delete";
/** Hunk-header keyword for insertion operations. */
export const HL_INSERT_KEYWORD = "insert";
/** Insert position keyword for inserting before a concrete line. */
export const HL_INSERT_BEFORE = "before";
/** Insert position keyword for inserting after a concrete line. */
export const HL_INSERT_AFTER = "after";
/** Insert position keyword for inserting at the start of the file. */
export const HL_INSERT_HEAD = "head";
/** Insert position keyword for inserting at the end of the file. */
export const HL_INSERT_TAIL = "tail";
/** Hunk-header terminator for body-bearing operations. */
export const HL_HEADER_COLON = ":";

/** Separator between a hashline file path and its opaque snapshot tag. */
export const HL_FILE_HASH_SEP = "#";

/** Separator between two line numbers in a range, e.g. `5..10`. */
export const HL_RANGE_SEP = "..";

/** Number of hex characters in a content-derived file-hash tag. */
export const HL_FILE_HASH_LENGTH = 6;

/** Canonical uppercase hexadecimal content-hash tag carried by a hashline section header. */
export const HL_FILE_HASH_RE_RAW = `[0-9A-F]{${HL_FILE_HASH_LENGTH}}`;

/** Capture-group form of {@link HL_FILE_HASH_RE_RAW}. */
export const HL_FILE_HASH_CAPTURE_RE_RAW = `(${HL_FILE_HASH_RE_RAW})`;

/**
 * Representative file-hash tags for use in user-facing error messages and
 * prompt examples.
 */
export const HL_FILE_HASH_EXAMPLES = ["1A2B3C", "4D5E6F", "9F3E1D"] as const;

/** Format a concrete replacement hunk header. */
export function formatReplaceHeader(start: number, end: number): string {
  return `${HL_REPLACE_KEYWORD} ${start}${HL_RANGE_SEP}${end}${HL_HEADER_COLON}`;
}

/** Format a concrete deletion hunk header. */
export function formatDeleteHeader(start: number, end = start): string {
  return start === end
    ? `${HL_DELETE_KEYWORD} ${start}`
    : `${HL_DELETE_KEYWORD} ${start}${HL_RANGE_SEP}${end}`;
}

/** Format an insertion hunk header for a cursor position. */
export function formatInsertHeader(cursor: Cursor): string {
  switch (cursor.kind) {
    case "before_anchor":
      return `${HL_INSERT_KEYWORD} ${HL_INSERT_BEFORE} ${cursor.anchor.line}${HL_HEADER_COLON}`;
    case "after_anchor":
      return `${HL_INSERT_KEYWORD} ${HL_INSERT_AFTER} ${cursor.anchor.line}${HL_HEADER_COLON}`;
    case "bof":
      return `${HL_INSERT_KEYWORD} ${HL_INSERT_HEAD}${HL_HEADER_COLON}`;
    case "eof":
      return `${HL_INSERT_KEYWORD} ${HL_INSERT_TAIL}${HL_HEADER_COLON}`;
  }
}

/**
 * Normalize text before hashing: trim trailing `[ \t\r]` from every line (and
 * the final line) in a single pass so CRLF endings and display-trimmed lines
 * do not invalidate a tag.
 */
function normalizeFileHashText(text: string): string {
  return text.replace(/[ \t\r]+(?=\n|$)/g, "");
}
/**
 * Compute the content-derived hash tag carried by a hashline section header.
 * The tag is a short hex fingerprint of the whole file's normalized text: any
 * read of byte-identical content mints the same tag, and a follow-up edit
 * anchored at any line validates whenever the live file still hashes to it.
 */
export function computeFileHash(text: string): string {
  const normalized = normalizeFileHashText(text);
  const hash = createHash("sha256").update(normalized).digest("hex");
  return hash.slice(0, HL_FILE_HASH_LENGTH).toUpperCase();
}

/** Format a hashline section header for a file path and snapshot tag. */
export function formatHashlineHeader(
  filePath: string,
  fileHash: string,
): string {
  return `${HL_FILE_PREFIX}${filePath}${HL_FILE_HASH_SEP}${fileHash}`;
}
