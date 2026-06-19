/**
 * Line classifier for hashline diff text.
 * Converts raw text lines into typed tokens consumed by the parser.
 */

import {
  HL_BLOCK_KEYWORD,
  HL_DELETE_KEYWORD,
  HL_FILE_HASH_LENGTH,
  HL_FILE_HASH_SEP,
  HL_FILE_PREFIX,
  HL_HEADER_COLON,
  HL_INSERT_AFTER,
  HL_INSERT_BEFORE,
  HL_INSERT_HEAD,
  HL_INSERT_KEYWORD,
  HL_INSERT_TAIL,
  HL_PAYLOAD_REPLACE,
  HL_REPLACE_KEYWORD,
} from "./format.js";
import type { Anchor, Cursor, ParsedRange } from "./types.js";

// ─── BlockTarget (the target of a hunk header) ───────────────────────

export type BlockTarget =
  | { kind: "replace"; range: ParsedRange }
  | { kind: "block"; anchor: Anchor }
  | { kind: "delete"; range: ParsedRange }
  | { kind: "delete_block"; anchor: Anchor }
  | { kind: "insert_before"; anchor: Anchor }
  | { kind: "insert_after"; anchor: Anchor }
  | { kind: "bof" }
  | { kind: "eof" };

// ─── Token types ─────────────────────────────────────────────────────

interface TokenBase {
  lineNum: number;
}

export type Token =
  | (TokenBase & { kind: "blank" })
  | (TokenBase & { kind: "envelope-begin" })
  | (TokenBase & { kind: "envelope-end" })
  | (TokenBase & { kind: "abort" })
  | (TokenBase & { kind: "header"; path: string; fileHash?: string })
  | (TokenBase & { kind: "op-block"; target: BlockTarget })
  | (TokenBase & { kind: "payload-literal"; text: string })
  | (TokenBase & { kind: "raw"; text: string });

// ─── Envelope / abort markers ────────────────────────────────────────

const ENVELOPE_BEGIN = "*** Begin Patch";
const ENVELOPE_END = "*** End Patch";
const ABORT_MARKER = "*** Abort";

// ─── Line-number scanner ─────────────────────────────────────────────

const LINE_RE = /^[1-9]\d*$/;

function parseLineNumber(raw: string, lineNum: number): number {
  const trimmed = raw.trim();
  if (!LINE_RE.test(trimmed)) {
    throw new Error(
      `line ${lineNum}: expected a positive line number; got ${JSON.stringify(raw)}.`,
    );
  }
  return Number.parseInt(trimmed, 10);
}

// ─── Range scanner ───────────────────────────────────────────────────

function parseRange(raw: string): ParsedRange | null {
  // Accept "N..M", "N...M", "N-M", "N–M" (en-dash), "N—M" (em-dash)
  const match = raw.match(
    /^([1-9]\d*)\s*(?:\.\.|\.\.\.|--?|[–—])\s*([1-9]\d*)$/,
  );
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const start = Number.parseInt(match[1], 10);
  const end = Number.parseInt(match[2], 10);
  return { start: { line: start }, end: { line: end } };
}

// ─── Keyword scanning ────────────────────────────────────────────────

/** Scan a required keyword followed by whitespace or colon/end. */
function scanKeyword(
  line: string,
  pos: number,
  keyword: string,
): number | null {
  if (!line.startsWith(keyword, pos)) {
    return null;
  }
  const next = pos + keyword.length;
  if (next < line.length) {
    const ch = line.charCodeAt(next);
    // Must be followed by whitespace, colon, or end of meaningful text
    if (
      ch !== 0x20 && // space
      ch !== 0x09 && // tab
      ch !== HL_HEADER_COLON.charCodeAt(0)
    ) {
      return null;
    }
  }
  return next;
}

// ─── Hunk header parser ──────────────────────────────────────────────

function parseHunkHeader(line: string, lineNum: number): BlockTarget | null {
  const trimmed = line.trimStart();
  let pos = 0;

  // --- replace --------------------------------------------------------
  const repPos = scanKeyword(trimmed, pos, HL_REPLACE_KEYWORD);
  if (repPos !== null) {
    pos = repPos;
    // Check for `replace block N:`
    const remainder = trimmed.slice(pos).trimStart();
    if (remainder.startsWith(HL_BLOCK_KEYWORD)) {
      const afterBlock = remainder
        .slice(HL_BLOCK_KEYWORD.length)
        .trimStart()
        .replace(/:$/, "");
      const num = parseLineNumber(afterBlock, lineNum);
      return { kind: "block", anchor: { line: num } };
    }
    // Parse `replace N..M:`
    const rangeText = remainder.replace(/:$/, "").trim();
    if (rangeText.length === 0) {
      return null;
    }
    const range = parseRange(rangeText);
    if (range === null) {
      return null;
    }
    // Must end with colon
    if (!trimmed.endsWith(HL_HEADER_COLON)) {
      return null;
    }
    return { kind: "replace", range };
  }

  // --- delete ---------------------------------------------------------
  const delPos = scanKeyword(trimmed, pos, HL_DELETE_KEYWORD);
  if (delPos !== null) {
    const remainder = trimmed.slice(delPos).trimStart();
    // Check for `delete block N`
    if (remainder.startsWith(HL_BLOCK_KEYWORD)) {
      const afterBlock = remainder.slice(HL_BLOCK_KEYWORD.length).trimStart();
      const num = parseLineNumber(afterBlock, lineNum);
      // No colon allowed
      const afterNum = afterBlock
        .slice(afterBlock.indexOf(String(num)) + String(num).length)
        .trim();
      if (afterNum.length > 0) {
        return null;
      }
      return { kind: "delete_block", anchor: { line: num } };
    }
    // Parse `delete N` or `delete N..M` (no colon)
    if (remainder.endsWith(HL_HEADER_COLON)) {
      return null; // delete doesn't take colon
    }
    const rangeText = remainder.trim();
    if (rangeText.length === 0) {
      return null;
    }
    // Could be range "N..M" or single line "N"
    const range = parseRange(rangeText);
    if (range !== null) {
      return { kind: "delete", range };
    }
    const num = parseLineNumber(rangeText, lineNum);
    return {
      kind: "delete",
      range: { start: { line: num }, end: { line: num } },
    };
  }

  // --- insert ---------------------------------------------------------
  const insPos = scanKeyword(trimmed, pos, HL_INSERT_KEYWORD);
  if (insPos !== null) {
    const remainder = trimmed.slice(insPos).trimStart();

    // insert before N:
    if (remainder.startsWith(HL_INSERT_BEFORE)) {
      const afterKw = remainder
        .slice(HL_INSERT_BEFORE.length)
        .trimStart()
        .replace(/:$/, "");
      const num = parseLineNumber(afterKw, lineNum);
      if (!trimmed.endsWith(HL_HEADER_COLON)) {
        return null;
      }
      return { kind: "insert_before", anchor: { line: num } };
    }
    // insert after N:
    if (remainder.startsWith(HL_INSERT_AFTER)) {
      const afterKw = remainder
        .slice(HL_INSERT_AFTER.length)
        .trimStart()
        .replace(/:$/, "");
      const num = parseLineNumber(afterKw, lineNum);
      if (!trimmed.endsWith(HL_HEADER_COLON)) {
        return null;
      }
      return { kind: "insert_after", anchor: { line: num } };
    }
    // insert head:
    if (remainder.startsWith(HL_INSERT_HEAD)) {
      const afterKw = remainder.slice(HL_INSERT_HEAD.length).trimStart();
      if (afterKw !== HL_HEADER_COLON) {
        return null;
      }
      return { kind: "bof" };
    }
    // insert tail:
    if (remainder.startsWith(HL_INSERT_TAIL)) {
      const afterKw = remainder.slice(HL_INSERT_TAIL.length).trimStart();
      if (afterKw !== HL_HEADER_COLON) {
        return null;
      }
      return { kind: "eof" };
    }
    return null;
  }

  return null;
}

// ─── Header parser ───────────────────────────────────────────────────

function parseHashlineHeader(
  line: string,
): { path: string; fileHash?: string } | null {
  const trimmed = line.trimEnd();
  if (!trimmed.startsWith(HL_FILE_PREFIX)) {
    return null;
  }
  const body = trimmed.slice(HL_FILE_PREFIX.length);
  const hashIdx = body.lastIndexOf(HL_FILE_HASH_SEP);

  let path: string;
  let fileHash: string | undefined;

  if (hashIdx >= 0) {
    path = body.slice(0, hashIdx);
    const hashCandidate = body.slice(hashIdx + 1);
    // Validate hash: exactly HL_FILE_HASH_LENGTH hex chars
    if (
      hashCandidate.length === HL_FILE_HASH_LENGTH &&
      /^[0-9A-Fa-f]{4}$/.test(hashCandidate)
    ) {
      fileHash = hashCandidate.toUpperCase();
    } else {
      // # not followed by valid hash — treat as part of path
      path = body;
    }
  } else {
    path = body;
  }

  if (path.length === 0) {
    return null;
  }
  return { path, fileHash };
}

// ─── Line classifier ─────────────────────────────────────────────────

/** Classify a single line into a token. */
function classifyLine(line: string, lineNum: number): Token {
  // Blank line
  if (line.trim().length === 0) {
    return { kind: "blank", lineNum };
  }

  // Envelope / abort markers (exact match on trimmed line)
  const trimmed = line.trimEnd();
  if (trimmed === ENVELOPE_BEGIN) {
    return { kind: "envelope-begin", lineNum };
  }
  if (trimmed === ENVELOPE_END) {
    return { kind: "envelope-end", lineNum };
  }
  if (trimmed === ABORT_MARKER) {
    return { kind: "abort", lineNum };
  }
  // File section header
  if (trimmed.startsWith(HL_FILE_PREFIX)) {
    const header = parseHashlineHeader(line);
    if (header !== null) {
      return header.fileHash !== undefined
        ? {
            kind: "header",
            lineNum,
            path: header.path,
            fileHash: header.fileHash,
          }
        : { kind: "header", lineNum, path: header.path };
    }
  }

  // Hunk header
  const hunk = parseHunkHeader(line, lineNum);
  if (hunk !== null) {
    return { kind: "op-block", lineNum, target: hunk };
  }

  // Payload literal
  if (line.startsWith(HL_PAYLOAD_REPLACE)) {
    return { kind: "payload-literal", lineNum, text: line.slice(1) };
  }

  // Bare text (auto-piped body row or noise)
  return { kind: "raw", lineNum, text: line };
}

// ─── Tokenizer class ─────────────────────────────────────────────────

/**
 * Stateful line-by-line tokenizer for hashline diff text.
 *
 * Usage:
 *   const tokenizer = new Tokenizer();
 *   const tokens = tokenizer.tokenizeAll(input);
 */
export class Tokenizer {
  /** Tokenize full text into an array of tokens. */
  tokenizeAll(text: string): Token[] {
    if (text.length === 0) {
      return [{ kind: "blank", lineNum: 1 }];
    }
    const lines = text.split("\n");
    const tokens: Token[] = [];
    for (let i = 0; i < lines.length; i++) {
      // Strip trailing \r for CRLF support
      let line = lines[i] ?? "";
      if (line.endsWith("\r")) line = line.slice(0, -1);
      tokens.push(classifyLine(line, i + 1));
    }
    return tokens;
  }

  /** Classify a single line. */
  tokenize(line: string, lineNum = 0): Token {
    return classifyLine(line, lineNum);
  }

  /** Check if a line is an op header. */
  isOp(line: string): boolean {
    return parseHunkHeader(line, 0) !== null;
  }

  /** Check if a line is a file section header. */
  isHeader(line: string): boolean {
    return parseHashlineHeader(line) !== null;
  }

  /** Check if a line is an envelope or abort marker. */
  isEnvelopeMarker(line: string): boolean {
    const trimmed = line.trimEnd();
    return (
      trimmed === ENVELOPE_BEGIN ||
      trimmed === ENVELOPE_END ||
      trimmed === ABORT_MARKER
    );
  }
}

/** Clone a cursor so edits own their anchor references. */
export function cloneCursor(cursor: Cursor): Cursor {
  if (cursor.kind === "before_anchor" || cursor.kind === "after_anchor") {
    return {
      kind: cursor.kind,
      anchor: { line: cursor.anchor.line },
    };
  }
  return cursor;
}
