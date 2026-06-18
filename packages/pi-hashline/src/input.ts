/**
 * High-level patch parser.
 *
 * Splits authored hashline input into {@link PatchSection}s, each rooted at a
 * `¶PATH#HASH` header, and exposes a {@link Patch} class that gives lazy
 * access to the parsed edits per section.
 *
 * The splitter is purely lexical — it doesn't know whether a section's path
 * actually exists. That's the patcher's job.
 */

import * as path from "node:path";

import { parsePatch } from "./parser";
import { Tokenizer } from "./tokenizer";
import type { Edit, SplitOptions } from "./types";

// ─── Header parsing ──────────────────────────────────────────────────

const TOKENIZER = new Tokenizer();

/**
 * Split raw input text into per-section structures keyed by `¶PATH#HASH` headers.
 * Each section collects all non-header lines until the next header.
 */
function splitIntoSections(
  input: string,
  options: SplitOptions = {},
): RawSection[] {
  const lines = input.split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | undefined;

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trimEnd();

    // Check for section header
    if (trimmed.startsWith("¶")) {
      const token = TOKENIZER.tokenize(line);
      if (token.kind === "header") {
        // Flush previous section
        if (
          current &&
          current.diffLines.length > 0 &&
          current.diffLines.some((l) => l.trim().length > 0)
        ) {
          sections.push({
            path: current.path,
            fileHash: current.fileHash,
            diffLines: current.diffLines,
          });
        }

        // Normalize path: make absolute paths relative to cwd
        let sectionPath = token.path;
        if (options.cwd && path.isAbsolute(sectionPath)) {
          const rel = path.relative(
            path.resolve(options.cwd),
            path.resolve(sectionPath),
          );
          if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
            sectionPath = rel || ".";
          }
        }

        current = {
          path: sectionPath,
          fileHash: token.fileHash,
          diffLines: [],
        };
        continue;
      }
    }

    // Accumulate line in current section
    if (current) {
      current.diffLines.push(line);
    }
    // Lines before the first header are silently dropped
  }

  // Flush final section
  if (
    current &&
    current.diffLines.length > 0 &&
    current.diffLines.some((l) => l.trim().length > 0)
  ) {
    sections.push({
      path: current.path,
      fileHash: current.fileHash,
      diffLines: current.diffLines,
    });
  }

  return sections;
}

interface RawSection {
  path: string;
  fileHash?: string;
  diffLines: string[];
}

// ─── PatchSection ────────────────────────────────────────────────────

/**
 * One section in a parsed {@link Patch}: a target file plus the lazily-
 * parsed list of edits that should land on it.
 */
export class PatchSection {
  readonly path: string;
  readonly fileHash: string | undefined;
  readonly diff: string;

  #parsed: { edits: Edit[]; warnings: string[] } | undefined;

  constructor(raw: RawSection) {
    this.path = raw.path;
    this.fileHash = raw.fileHash;
    this.diff = raw.diffLines.join("\n");
  }

  /**
   * Parse this section's diff body. Cached: subsequent calls return the
   * same `{ edits, warnings }` object.
   */
  parse(): { edits: Edit[]; warnings: string[] } {
    this.#parsed ??= parsePatch(this.diff);
    return this.#parsed;
  }

  /** Parsed edits for this section (lazy). */
  get edits(): Edit[] {
    return this.parse().edits;
  }

  /** Warnings emitted during parsing of this section (lazy). */
  get warnings(): string[] {
    return this.parse().warnings;
  }

  /**
   * True when at least one edit anchors to concrete file content.
   * Pure `insert head:` / `insert tail:` literal inserts do not count.
   */
  get hasAnchoredEdit(): boolean {
    return this.edits.some((edit) => {
      if (edit.kind === "delete") {
        return true;
      }
      if (edit.kind === "block") {
        return true;
      }
      return (
        edit.cursor.kind === "before_anchor" ||
        edit.cursor.kind === "after_anchor"
      );
    });
  }

  /** Anchor lines touched by this section, sorted ascending and deduplicated. */
  collectAnchorLines(): number[] {
    const lines = new Set<number>();
    for (const edit of this.edits) {
      if (edit.kind === "delete") {
        lines.add(edit.anchor.line);
        continue;
      }
      if (edit.kind === "block") {
        lines.add(edit.anchor.line);
        continue;
      }
      if (
        edit.cursor.kind === "before_anchor" ||
        edit.cursor.kind === "after_anchor"
      ) {
        lines.add(edit.cursor.anchor.line);
      }
    }
    return [...lines].sort((a, b) => a - b);
  }
}

// ─── Patch ───────────────────────────────────────────────────────────

/**
 * A parsed hashline patch — zero or more {@link PatchSection}s, each rooted
 * at a `¶PATH#HASH` header.
 *
 * `Patch` is pure data: parsing is line-anchored and does not look at the
 * filesystem. To apply a patch, hand it to the patcher.
 */
export class Patch {
  readonly sections: readonly PatchSection[];

  private constructor(sections: PatchSection[]) {
    this.sections = sections;
  }

  /**
   * Parse `input` into a {@link Patch}.
   *
   * `options.cwd` resolves absolute paths inside headers to cwd-relative form.
   */
  static parse(input: string, options: SplitOptions = {}): Patch {
    const rawSections = splitIntoSections(input, options);

    if (rawSections.length === 0) {
      throw new Error(
        `Patch input must begin with "¶PATH#HASH" on the first non-blank line for anchored edits. ` +
          'Example: "¶src/foo.ts#0A3" then edit ops.',
      );
    }

    const sections = rawSections.map((raw) => new PatchSection(raw));
    return new Patch(sections);
  }

  /**
   * Parse `input` and return only the first section. Throws if the input
   * has zero sections.
   */
  static parseSingle(input: string, options: SplitOptions = {}): PatchSection {
    const patch = Patch.parse(input, options);
    const first = patch.sections[0];
    if (!first) {
      throw new Error("Patch input did not produce any sections.");
    }
    return first;
  }
}
