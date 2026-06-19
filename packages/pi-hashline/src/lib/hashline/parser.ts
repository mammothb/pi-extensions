/**
 * Token-driven parser that converts a stream of {@link Token}s into a flat
 * list of {@link Edit}s.
 *
 * Sits between the {@link Tokenizer} and the applier. Block ops (`replace
 * block N:`, `delete block N`) are parsed but not resolved — resolution
 * requires file text + language detection and happens at apply time.
 */

import { HL_PAYLOAD_REPLACE } from "./format.js";
import type { BlockTarget, Token } from "./tokenizer.js";
import { Tokenizer } from "./tokenizer.js";
import type { Anchor, Cursor, Edit, ParsedRange } from "./types.js";

// ─── Warning / error message constants ───────────────────────────────

const BARE_BODY_AUTO_PIPED_WARNING =
  "Auto-prefixed bare body row(s) with `+`. Body rows must be `+TEXT` literal lines.";

const EMPTY_REPLACE =
  "`replace N..M:` needs at least one `+TEXT` body row. To delete lines, use `delete N..M`.";

const EMPTY_INSERT = "`insert` needs at least one `+TEXT` body row.";

const EMPTY_BLOCK =
  "`replace block N:` needs at least one `+TEXT` body row. To delete a block, use `delete N..M` with the block's line range.";

const DELETE_TAKES_NO_BODY =
  "`delete N..M` does not take body rows. Remove the body, or use `replace N..M:`.";

const DELETE_BLOCK_TAKES_NO_BODY =
  "`delete block N` does not take body rows. Remove the body, or use `replace block N:` to replace the block.";

const MINUS_ROW_REJECTED =
  "`-` rows are not valid; hashline ranges already name the lines being changed. To insert a literal line starting with `-`, write `+-…`.";

// ─── Internal payload row ────────────────────────────────────────────

interface PayloadRow {
  text: string;
  lineNum: number;
}

// ─── Clone helpers ───────────────────────────────────────────────────

function cloneAnchor(a: Anchor): Anchor {
  return { line: a.line };
}

function cloneCursor(c: Cursor): Cursor {
  switch (c.kind) {
    case "before_anchor":
      return { kind: "before_anchor", anchor: cloneAnchor(c.anchor) };
    case "after_anchor":
      return { kind: "after_anchor", anchor: cloneAnchor(c.anchor) };
    default:
      return c;
  }
}

// ─── Range expansion ─────────────────────────────────────────────────

function expandRange(range: ParsedRange): Anchor[] {
  const anchors: Anchor[] = [];
  for (let line = range.start.line; line <= range.end.line; line++) {
    anchors.push({ line });
  }
  return anchors;
}

// ─── Parse state ─────────────────────────────────────────────────────

interface PendingOp {
  target: BlockTarget;
  lineNum: number;
  payloads: PayloadRow[];
}

interface ParseState {
  edits: Edit[];
  warnings: string[];
  editIndex: number;
  pending: PendingOp | undefined;
  terminated: boolean;
}

function createState(): ParseState {
  return {
    edits: [],
    warnings: [],
    editIndex: 0,
    pending: undefined,
    terminated: false,
  };
}

// ─── Edit emission ───────────────────────────────────────────────────

function pushInsert(
  state: ParseState,
  cursor: Cursor,
  text: string,
  lineNum: number,
  mode?: "replacement",
): void {
  state.edits.push({
    kind: "insert",
    cursor: cloneCursor(cursor),
    text,
    lineNum,
    index: state.editIndex++,
    ...(mode === undefined ? {} : { mode }),
  });
}

function pushDelete(state: ParseState, anchor: Anchor, lineNum: number): void {
  state.edits.push({
    kind: "delete",
    anchor: cloneAnchor(anchor),
    lineNum,
    index: state.editIndex++,
  });
}

function pushBlock(
  state: ParseState,
  anchor: Anchor,
  payloads: readonly PayloadRow[],
  lineNum: number,
): void {
  state.edits.push({
    kind: "block",
    anchor: cloneAnchor(anchor),
    payloads: payloads.map((p) => p.text),
    lineNum,
    index: state.editIndex++,
  });
}

function emitPayloads(
  state: ParseState,
  cursor: Cursor,
  payloads: readonly PayloadRow[],
  lineNum: number,
  mode?: "replacement",
): void {
  for (const payload of payloads) {
    pushInsert(state, cursor, payload.text, lineNum, mode);
  }
}

// ─── Flush pending op ────────────────────────────────────────────────

function flushPending(state: ParseState): void {
  const pending = state.pending;
  if (!pending) {
    return;
  }
  state.pending = undefined;

  const { target, lineNum, payloads } = pending;

  switch (target.kind) {
    case "delete": {
      // Delete takes no body
      for (const anchor of expandRange(target.range)) {
        pushDelete(state, anchor, lineNum);
      }
      return;
    }

    case "delete_block": {
      // Block delete with no payloads
      pushBlock(state, target.anchor, [], lineNum);
      return;
    }

    case "block": {
      // Replace block needs body
      if (payloads.length === 0) {
        throw new Error(`line ${lineNum}: ${EMPTY_BLOCK}`);
      }
      pushBlock(state, target.anchor, payloads, lineNum);
      return;
    }

    case "replace": {
      // Replace needs body
      if (payloads.length === 0) {
        throw new Error(`line ${lineNum}: ${EMPTY_REPLACE}`);
      }
      const cursor: Cursor = {
        kind: "before_anchor",
        anchor: cloneAnchor(target.range.start),
      };
      emitPayloads(state, cursor, payloads, lineNum, "replacement");
      for (const anchor of expandRange(target.range)) {
        pushDelete(state, anchor, lineNum);
      }
      return;
    }

    case "insert_before": {
      if (payloads.length === 0) {
        throw new Error(`line ${lineNum}: ${EMPTY_INSERT}`);
      }
      emitPayloads(
        state,
        { kind: "before_anchor", anchor: cloneAnchor(target.anchor) },
        payloads,
        lineNum,
      );
      return;
    }

    case "insert_after": {
      if (payloads.length === 0) {
        throw new Error(`line ${lineNum}: ${EMPTY_INSERT}`);
      }
      emitPayloads(
        state,
        { kind: "after_anchor", anchor: cloneAnchor(target.anchor) },
        payloads,
        lineNum,
      );
      return;
    }

    case "bof": {
      if (payloads.length === 0) {
        throw new Error(`line ${lineNum}: ${EMPTY_INSERT}`);
      }
      emitPayloads(state, { kind: "bof" }, payloads, lineNum);
      return;
    }

    case "eof": {
      if (payloads.length === 0) {
        throw new Error(`line ${lineNum}: ${EMPTY_INSERT}`);
      }
      emitPayloads(state, { kind: "eof" }, payloads, lineNum);
      return;
    }
  }
}

// ─── Validate range order ────────────────────────────────────────────

function validateRangeOrder(range: ParsedRange, lineNum: number): void {
  if (range.end.line < range.start.line) {
    throw new Error(
      `line ${lineNum}: range ${range.start.line}..${range.end.line} ends before it starts.`,
    );
  }
}

// ─── Overlapping delete detection ────────────────────────────────────

function validateNoOverlappingDeletes(edits: Edit[]): void {
  const sourceLinesByAnchor = new Map<number, number[]>();
  for (const edit of edits) {
    if (edit.kind !== "delete") {
      continue;
    }
    let sourceLines = sourceLinesByAnchor.get(edit.anchor.line);
    if (sourceLines === undefined) {
      sourceLines = [];
      sourceLinesByAnchor.set(edit.anchor.line, sourceLines);
    }
    if (!sourceLines.includes(edit.lineNum)) {
      sourceLines.push(edit.lineNum);
    }
  }
  for (const [anchorLine, sourceLines] of sourceLinesByAnchor) {
    if (sourceLines.length < 2) {
      continue;
    }
    const [firstBlock, secondBlock] = [...sourceLines].sort((a, b) => a - b);
    throw new Error(
      `line ${secondBlock}: anchor line ${anchorLine} is already targeted by another hunk on line ${firstBlock}. Issue ONE hunk per range.`,
    );
  }
}

// ─── Token consumer ──────────────────────────────────────────────────

function feedToken(state: ParseState, token: Token): void {
  if (state.terminated) {
    return;
  }

  switch (token.kind) {
    case "envelope-begin":
    case "blank":
      // Silently consumed
      return;

    case "envelope-end":
    case "abort":
      state.terminated = true;
      return;

    case "header":
      // A new section header flushes the previous section's pending op
      flushPending(state);
      return;

    case "op-block": {
      // Validate range order for literal replace/delete
      if (token.target.kind === "replace" || token.target.kind === "delete") {
        validateRangeOrder(token.target.range, token.lineNum);
      }
      flushPending(state);
      state.pending = {
        target: token.target,
        lineNum: token.lineNum,
        payloads: [],
      };
      return;
    }

    case "payload-literal": {
      if (!state.pending) {
        throw new Error(
          `line ${token.lineNum}: payload line has no preceding hunk header. Got ${JSON.stringify(`${HL_PAYLOAD_REPLACE}${token.text}`)}.`,
        );
      }
      if (
        state.pending.target.kind === "delete" ||
        state.pending.target.kind === "delete_block"
      ) {
        const msg =
          state.pending.target.kind === "delete"
            ? DELETE_TAKES_NO_BODY
            : DELETE_BLOCK_TAKES_NO_BODY;
        throw new Error(`line ${token.lineNum}: ${msg}`);
      }
      state.pending.payloads.push({
        text: token.text,
        lineNum: token.lineNum,
      });
      return;
    }

    case "raw": {
      // Raw line without a pending op is an error
      if (!state.pending) {
        const trimmed = token.text.trim();
        if (trimmed.length === 0) {
          return; // blank-like
        }
        throw new Error(
          `line ${token.lineNum}: payload line has no preceding hunk header. Use \`replace N..M:\`, \`delete N..M\`, or \`insert before|after|head|tail:\` above the body. Got ${JSON.stringify(token.text)}.`,
        );
      }

      // Delete ops can't have body
      if (
        state.pending.target.kind === "delete" ||
        state.pending.target.kind === "delete_block"
      ) {
        const msg =
          state.pending.target.kind === "delete"
            ? DELETE_TAKES_NO_BODY
            : DELETE_BLOCK_TAKES_NO_BODY;
        throw new Error(`line ${token.lineNum}: ${msg}`);
      }

      // Reject `-` rows (unified-diff contamination)
      if (token.text.trimStart().startsWith("-")) {
        throw new Error(`line ${token.lineNum}: ${MINUS_ROW_REJECTED}`);
      }

      // Auto-pipe bare body rows
      if (!state.warnings.includes(BARE_BODY_AUTO_PIPED_WARNING)) {
        state.warnings.push(BARE_BODY_AUTO_PIPED_WARNING);
      }
      state.pending.payloads.push({
        text: token.text,
        lineNum: token.lineNum,
      });
      return;
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Parse hashline diff text into a flat list of edits and warnings.
 *
 * This is the core parsing entry point. It tokenizes the input, feeds
 * tokens through the state machine, flushes any pending op, and validates
 * the result.
 */
export function parsePatch(diff: string): {
  edits: Edit[];
  warnings: string[];
} {
  const tokenizer = new Tokenizer();
  const state = createState();

  for (const token of tokenizer.tokenizeAll(diff)) {
    feedToken(state, token);
  }

  // Flush any remaining pending op
  flushPending(state);

  // Validate no overlapping deletes
  validateNoOverlappingDeletes(state.edits);

  return { edits: state.edits, warnings: state.warnings };
}
