/**
 * Error raised when a hashline section's snapshot tag does not match the live
 * file's content and recovery is unavailable or has failed.
 *
 * Carries the file lines plus anchored lines so renderers can produce a
 * richer diagnostic via {@link MismatchError.displayMessage}.
 */

import {
  formatNumberedLine,
  HL_FILE_HASH_EXAMPLES,
  HL_FILE_HASH_SEP,
  HL_FILE_PREFIX,
} from "./format.js";

// ─── Constants ────────────────────────────────────────────────────────

/** Lines of context shown around each anchor in mismatch diagnostics. */
export const MISMATCH_CONTEXT = 2;

const LINE_REF_RE = /^\s*[>+\-*]*\s*(\d+)(?::.*)?\s*$/;

// ─── MismatchDetails ──────────────────────────────────────────────────

export interface MismatchDetails {
  /** Display-relative file path (optional). */
  path?: string;
  /** The tag the edit was authored against. */
  expectedFileHash: string;
  /** The tag of the current live file. */
  actualFileHash: string;
  /** Full text of the live file as an array of lines. */
  fileLines: string[];
  /** Anchor lines targeted by the edit (1-indexed). */
  anchorLines?: readonly number[];
  /**
   * `true` when the section's expected hash resolved to a recorded snapshot
   * (file content drifted since that snapshot), `false` when no snapshot
   * was ever recorded for the hash (likely fabricated or carried over from a
   * prior session). Drives a more actionable rejection message; defaults to
   * `true` for backward compatibility with direct callers.
   */
  hashRecognized?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Format the required-shape diagnostic shown when a line reference is malformed. */
export function formatFullAnchorRequirement(raw?: string): string {
  const received = raw === undefined ? "" : ` Received ${JSON.stringify(raw)}.`;
  return (
    `a bare line number from read/search output plus the section header content-hash tag ` +
    `(for example ${HL_FILE_PREFIX}src/foo.ts${HL_FILE_HASH_SEP}${HL_FILE_HASH_EXAMPLES[0]} and line "160")${received}`
  );
}

/** Parse a decorated bare line-number anchor like `42`, `*42:foo`, ` > 7`. */
export function parseTag(ref: string): { line: number } {
  const match = ref.match(LINE_REF_RE);
  if (!match) {
    throw new Error(
      `Invalid line reference. Expected ${formatFullAnchorRequirement(ref)}.`,
    );
  }
  const line = Number.parseInt(match[1], 10);
  if (line < 1) {
    throw new Error(`Line number must be >= 1, got ${line} in "${ref}".`);
  }
  return { line };
}

/** Throws when the line reference is out of bounds for the given file. */
export function validateLineRef(
  ref: { line: number },
  fileLines: string[],
): void {
  if (ref.line < 1 || ref.line > fileLines.length) {
    throw new Error(
      `Line ${ref.line} does not exist (file has ${fileLines.length} lines)`,
    );
  }
}

function getMismatchDisplayLines(
  anchorLines: readonly number[],
  fileLines: string[],
): number[] {
  const displayLines = new Set<number>();
  for (const line of anchorLines) {
    if (line < 1 || line > fileLines.length) {
      continue;
    }
    const lo = Math.max(1, line - MISMATCH_CONTEXT);
    const hi = Math.min(fileLines.length, line + MISMATCH_CONTEXT);
    for (let lineNum = lo; lineNum <= hi; lineNum++) {
      displayLines.add(lineNum);
    }
  }
  return [...displayLines].sort((a, b) => a - b);
}

// ─── MismatchError ────────────────────────────────────────────────────

/**
 * Raised when a hashline section's snapshot tag doesn't match the live file's
 * content (and recovery, if configured, declined the merge).
 *
 * The {@link displayMessage} getter produces a rich diagnostic with anchor-line
 * context and actionable recovery instructions, suitable for rendering to both
 * the user and the model.
 */
export class MismatchError extends Error {
  readonly path: string | undefined;
  readonly expectedFileHash: string;
  readonly actualFileHash: string;
  readonly fileLines: string[];
  readonly anchorLines: readonly number[];
  readonly hashRecognized: boolean;

  constructor(details: MismatchDetails) {
    super(MismatchError.formatMessage(details));
    this.name = "MismatchError";
    this.path = details.path;
    this.expectedFileHash = details.expectedFileHash;
    this.actualFileHash = details.actualFileHash;
    this.fileLines = details.fileLines;
    this.anchorLines = details.anchorLines ?? [];
    this.hashRecognized = details.hashRecognized ?? true;
  }

  /**
   * Rich diagnostic message with anchor-line context and actionable recovery
   * instructions. Use this for rendering to users and models.
   */
  get displayMessage(): string {
    return MismatchError.formatDisplayMessage({
      path: this.path,
      expectedFileHash: this.expectedFileHash,
      actualFileHash: this.actualFileHash,
      fileLines: this.fileLines,
      anchorLines: this.anchorLines,
      hashRecognized: this.hashRecognized,
    });
  }

  /**
   * Rejection header lines explaining why the edit was rejected.
   * Two variants depending on `hashRecognized`:
   * - `true`: file changed between read and edit (session drift)
   * - `false`: hash never recorded (fabricated or cross-session)
   */
  static rejectionHeader(details: MismatchDetails): string[] {
    const pathText = details.path ? ` for ${details.path}` : "";
    const hashRecognized = details.hashRecognized ?? true;
    if (!hashRecognized) {
      return [
        `Edit rejected${pathText}: hash ${HL_FILE_HASH_SEP}${details.expectedFileHash} is not from this session.`,
        `The current file hashes to ${HL_FILE_HASH_SEP}${details.actualFileHash}. Re-read the file with \`read\` to copy a current ${HL_FILE_PREFIX}path${HL_FILE_HASH_SEP}tag header — never invent the tag and never reuse one from a prior session.`,
      ];
    }
    return [
      `Edit rejected${pathText}: file changed between read and edit.`,
      `Section is bound to ${HL_FILE_HASH_SEP}${details.expectedFileHash}, but the current file hashes to ${HL_FILE_HASH_SEP}${details.actualFileHash}. If a prior edit in this session modified this file, copy the ${HL_FILE_PREFIX}path${HL_FILE_HASH_SEP}newhash header from that edit's response; otherwise re-read the file with \`read\` to refresh the tag before retrying.`,
    ];
  }

  /**
   * Full diagnostic message: rejection header + anchor-line context.
   * Anchor lines are marked with `*`, surrounding context with ` `.
   * Gaps between non-adjacent anchor regions are collapsed with `...`.
   */
  static formatDisplayMessage(details: MismatchDetails): string {
    return MismatchError.formatMessage(details);
  }

  /** @internal Implementation of the formatted message. */
  static formatMessage(details: MismatchDetails): string {
    const anchorSet = new Set(details.anchorLines ?? []);
    const lines = MismatchError.rejectionHeader(details);
    const displayLines = getMismatchDisplayLines(
      details.anchorLines ?? [],
      details.fileLines,
    );
    if (displayLines.length === 0) {
      return lines.join("\n");
    }
    lines.push("");
    let previous = -1;
    for (const lineNum of displayLines) {
      if (previous !== -1 && lineNum > previous + 1) {
        lines.push("...");
      }
      previous = lineNum;
      const text = details.fileLines[lineNum - 1] ?? "";
      const marker = anchorSet.has(lineNum) ? "*" : " ";
      lines.push(`${marker}${formatNumberedLine(lineNum, text)}`);
    }
    return lines.join("\n");
  }
}
