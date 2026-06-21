/**
 * Per-line content hashing for hashline anchoring.
 *
 * Produces one 4-character hex hash per line via SHA-256 prefix with
 * collision resolution. Zero new dependencies — reuses node:crypto
 * already imported by format.ts for file-level hashing.
 */

import { createHash } from "node:crypto";

/** Length of each per-line content hash (hex characters). */
export const LINE_HASH_LENGTH = 4;

/** Separator between a line hash and its content in read/write output. */
export const HL_HASH_LINE_BODY_SEP = "\u2502"; // "│" — box-drawing vertical bar

/** Hex alphabet used by line hashes. */
export const LINE_HASH_ALPHABET = "0123456789abcdef";

/**
 * Normalize a line before hashing: strip CR, trim trailing whitespace.
 * Must match the canonical form used by the read tool so hashes are
 * stable across reads of the same content.
 */
function canonicalizeLine(line: string): string {
  return line.replace(/\r/g, "").trimEnd();
}

/**
 * Compute per-line content hashes for a full file.
 *
 * Returns one 4-char hex hash per line (same length as `content.split("\n")`).
 * Uses SHA-256 prefix with collision resolution: if a base hash collides with
 * an already-assigned hash, append a retry counter `:R{n}` and re-hash until
 * unique. This ensures every line gets a distinct anchor even with identical
 * content (e.g. repeated `}` or `import` statements).
 *
 * Pure function — deterministic for identical content.
 */
export function computeLineHashes(content: string): string[] {
  const lines = content.split("\n");
  const hashes = new Array<string>(lines.length);
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const canonical = canonicalizeLine(lines[i] as string);
    let hash = createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, LINE_HASH_LENGTH);
    let retry = 0;
    while (seen.has(hash)) {
      retry++;
      hash = createHash("sha256")
        .update(`${canonical}:R${retry}`)
        .digest("hex")
        .slice(0, LINE_HASH_LENGTH);
    }
    seen.add(hash);
    hashes[i] = hash;
  }
  return hashes;
}

/**
 * Format a region of lines with hash-anchored prefixes.
 *
 * Each output line is `HASH│content` where HASH is the 4-char hex hash
 * and `│` is the box-drawing separator. Caller must ensure `hashes.length`
 * matches `lines.length`.
 */
export function formatHashlineRegion(
  hashes: string[],
  lines: string[],
): string {
  if (hashes.length !== lines.length) {
    throw new Error(
      `formatHashlineRegion: hashes.length (${hashes.length}) must match lines.length (${lines.length}).`,
    );
  }
  return lines
    .map((line, index) => `${hashes[index]}${HL_HASH_LINE_BODY_SEP}${line}`)
    .join("\n");
}
