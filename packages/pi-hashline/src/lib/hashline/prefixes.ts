/**
 * When a hashline payload is authored against `read`/`search` output, each
 * line is prefixed with either a hashline-mode line number (`123:`) or hash
 * anchor (`aB3f│`), or for diff-style echoes, a leading `+`. These helpers
 * detect that and recover the raw text. Two strip modes are exposed:
 *
 * - {@link stripNewLinePrefixes} — opportunistic: strips when the input
 *   clearly carries hashline or diff prefixes, leaves it alone otherwise.
 * - {@link stripHashlinePrefixes} — strict: only strips when every non-empty
 *   content line is hashline-prefixed.
 *
 * These run *before* the tokenizer; they exist because hashline mode is the
 * common case for echoed file content, and erroneously echoed prefixes will
 * otherwise turn every content line into a (malformed) op.
 */

const HL_PREFIX_RE = /^\s*(?:>>>|>>)?\s*(?:[+*-]\s*)?\d+:/;
const HL_PREFIX_PLUS_RE = /^\s*(?:>>>|>>)?\s*\+\s*\d+:/;
/** Matches hashline hash-anchored lines: `aB3f│content`. */
const HL_HASH_PREFIX_RE = /^\s*(?:>>>|>>)?\s*(?:[+*-]\s*)?[0-9a-f]{4}│/;
/** Matches diff-echoed hash-anchored lines: `+aB3f│content`. */
const HL_HASH_PREFIX_PLUS_RE = /^\s*(?:>>>|>>)?\s*\+\s*[0-9a-f]{4}│/;
const HL_HEADER_RE = /^\s*¶\S+#[0-9a-fA-F]{6}\s*$/;
const DIFF_PLUS_RE = /^[+](?![+])/;
const READ_TRUNCATION_NOTICE_RE =
  /^\[(?:Showing lines \d+-\d+ of \d+|\d+ more lines? in (?:file|\S+))\b.*\bUse :L?\d+/;

function stripLeadingHashlinePrefixes(line: string): string {
  let result = line;
  let previous: string;
  do {
    previous = result;
    result = result.replace(HL_PREFIX_RE, "").replace(HL_HASH_PREFIX_RE, "");
  } while (result !== previous);
  return result;
}

interface LinePrefixStats {
  nonEmpty: number;
  headerCount: number;
  hashPrefixCount: number;
  hashAnchorPrefixCount: number;
  diffPlusHashPrefixCount: number;
  diffPlusHashAnchorPrefixCount: number;
  diffPlusCount: number;
  truncationNoticeCount: number;
}

function collectLinePrefixStats(lines: string[]): LinePrefixStats {
  const stats: LinePrefixStats = {
    nonEmpty: 0,
    headerCount: 0,
    hashPrefixCount: 0,
    hashAnchorPrefixCount: 0,
    diffPlusHashPrefixCount: 0,
    diffPlusHashAnchorPrefixCount: 0,
    diffPlusCount: 0,
    truncationNoticeCount: 0,
  };

  for (const line of lines) {
    if (line.length === 0) {
      continue;
    }
    if (READ_TRUNCATION_NOTICE_RE.test(line)) {
      stats.truncationNoticeCount++;
      continue;
    }
    if (HL_HEADER_RE.test(line)) {
      stats.nonEmpty++;
      stats.headerCount++;
      continue;
    }
    stats.nonEmpty++;
    if (HL_PREFIX_RE.test(line)) {
      stats.hashPrefixCount++;
    }
    if (HL_HASH_PREFIX_RE.test(line)) {
      stats.hashAnchorPrefixCount++;
    }
    if (HL_PREFIX_PLUS_RE.test(line)) {
      stats.diffPlusHashPrefixCount++;
    }
    if (HL_HASH_PREFIX_PLUS_RE.test(line)) {
      stats.diffPlusHashAnchorPrefixCount++;
    }
    if (DIFF_PLUS_RE.test(line)) {
      stats.diffPlusCount++;
    }
  }
  return stats;
}

/**
 * Strip whichever prefix scheme the lines appear to be carrying:
 * - hashline line-number prefixes (`123:`) or hash anchors (`aB3f│`)
 *   when every content line has one
 * - leading `+` (diff style) when at least half the lines have one
 * - mixed `+<n>:` or `+HASH│` form when present
 *
 * Returns the lines untouched if no scheme is recognized.
 */
export function stripNewLinePrefixes(lines: string[]): string[] {
  const stats = collectLinePrefixStats(lines);
  if (stats.nonEmpty === 0) {
    return lines;
  }

  const contentLineCount = stats.nonEmpty - stats.headerCount;
  const totalHashPrefixCount =
    stats.hashPrefixCount + stats.hashAnchorPrefixCount;
  const stripHash =
    contentLineCount > 0 && totalHashPrefixCount === contentLineCount;
  const totalDiffPlusHashPrefixCount =
    stats.diffPlusHashPrefixCount + stats.diffPlusHashAnchorPrefixCount;
  const stripPlus =
    !stripHash &&
    totalDiffPlusHashPrefixCount === 0 &&
    stats.diffPlusCount > 0 &&
    stats.diffPlusCount >= stats.nonEmpty * 0.5;

  if (!stripHash && !stripPlus && totalDiffPlusHashPrefixCount === 0) {
    return lines;
  }

  return lines
    .filter(
      (line) =>
        !READ_TRUNCATION_NOTICE_RE.test(line) &&
        !(stripHash && HL_HEADER_RE.test(line)),
    )
    .map((line) => {
      if (stripHash) {
        return stripLeadingHashlinePrefixes(line);
      }
      if (stripPlus) {
        return line.replace(DIFF_PLUS_RE, "");
      }
      if (totalDiffPlusHashPrefixCount > 0) {
        if (HL_PREFIX_PLUS_RE.test(line)) {
          return line.replace(HL_PREFIX_RE, "");
        }
        if (HL_HASH_PREFIX_PLUS_RE.test(line)) {
          return line.replace(HL_HASH_PREFIX_RE, "");
        }
      }
      return line;
    });
}

/**
 * Strict variant: strip hashline prefixes only when every content line is
 * hashline-prefixed. Returns the lines unchanged otherwise.
 */
export function stripHashlinePrefixes(lines: string[]): string[] {
  const stats = collectLinePrefixStats(lines);
  if (stats.nonEmpty === 0) {
    return lines;
  }
  const contentLineCount = stats.nonEmpty - stats.headerCount;
  const totalHashPrefixCount =
    stats.hashPrefixCount + stats.hashAnchorPrefixCount;
  if (contentLineCount === 0 || totalHashPrefixCount !== contentLineCount) {
    return lines;
  }
  return lines
    .filter(
      (line) =>
        !READ_TRUNCATION_NOTICE_RE.test(line) && !HL_HEADER_RE.test(line),
    )
    .map((line) => stripLeadingHashlinePrefixes(line));
}

/**
 * Normalize line payloads by stripping read/search line prefixes. `null` /
 * `undefined` yield `[]`; a single multiline string is split on `\n`.
 */
export function hashlineParseText(
  edit: string[] | string | null | undefined,
): string[] {
  if (edit == null) {
    return [];
  }
  if (typeof edit === "string") {
    const trimmed = edit.endsWith("\n") ? edit.slice(0, -1) : edit;
    edit = trimmed.replaceAll("\r", "").split("\n");
  }
  return stripNewLinePrefixes(edit);
}
