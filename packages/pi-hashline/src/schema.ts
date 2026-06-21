/**
 * TypeBox schemas and Details types for all four hashline tools.
 * Centralized here so the API surface is visible in one place.
 */

import { Type } from "typebox";

// -- Edit tool ------------------------------------------------------------

export const EditSchema = Type.Object({
  edits: Type.Optional(
    Type.String({
      description:
        "Hashline patch text: one or more \u00b6PATH#TAG sections followed by edit operations " +
        "(replace N..M:, delete N..M, insert before|after|head|tail:). Copy the \u00b6PATH#TAG " +
        "header from the read tool output.",
    }),
  ),
  // JSON format (mutually exclusive with edits). Uses line numbers in Phase 1,
  // hash anchors added in Phase 2.
  path: Type.Optional(
    Type.String({ description: "File path to edit (JSON format)" }),
  ),
  patch: Type.Optional(
    Type.Array(
      Type.Object({
        old_range: Type.Array(Type.Union([Type.Number(), Type.String()]), {
          minItems: 2,
          maxItems: 2,
          description:
            "Inclusive line range [start, end] — numbers now, hash anchors in Phase 2",
        }),
        new_lines: Type.Array(Type.String(), {
          description: "Replacement content, one string per line",
        }),
      }),
      { description: "Edits to apply" },
    ),
  ),
});

export interface EditToolDetails {
  /** Per-file results. */
  files: EditFileResult[];
  /** Whether any files were changed. */
  changed: boolean;
}

export interface EditFileResult {
  /** Display-relative path. */
  path: string;
  /** New snapshot tag after the edit. */
  fileHash: string;
  /** Hashline header for the new version. */
  header: string;
  /** First changed line (1-indexed), or undefined for no-op. */
  firstChangedLine?: number;
  /** Warnings from parsing or drift. */
  warnings?: string[];
  /** Numbered preview lines around the change. */
  preview: string;
}

// -- Read tool ------------------------------------------------------------

export const ReadSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to read (relative or absolute)",
  }),
  offset: Type.Optional(
    Type.Number({
      description: "Line number to start reading from (1-indexed)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of lines to read",
    }),
  ),
});

export interface ReadToolDetails {
  /** Total lines in the file (before offset/limit). */
  totalLines: number;
  /** Total bytes in the file. */
  totalBytes: number;
  /** Whether the displayed output was truncated. */
  truncated: boolean;
  /** Content hash of the full file. */
  fileHash: string;
  /** Hashline header for this file snapshot. */
  header: string;
}

// -- Write tool -----------------------------------------------------------

export const WriteSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to write (relative or absolute)",
  }),
  content: Type.String({
    description: "Content to write to the file",
  }),
});

export interface WriteToolDetails {
  /** Total lines written. */
  totalLines: number;
  /** Content hash of the written file. */
  fileHash: string;
  /** Hashline header for the new version. */
  header: string;
}

// -- Grep tool ------------------------------------------------------------

export const GrepSchema = Type.Object({
  pattern: Type.String({
    description: "The regex pattern to search for (ripgrep syntax)",
  }),
  path: Type.Optional(
    Type.String({
      description:
        "File or directory to search in (default: current working directory)",
    }),
  ),
  glob: Type.Optional(
    Type.String({
      description:
        "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description:
        "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({
      description: "Case-insensitive search (default: false)",
    }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description:
        "Treat pattern as literal string instead of regex (default: false)",
    }),
  ),
});

export interface GrepToolDetails {
  /** Number of files with matches. */
  filesWithMatches: number;
  /** Total matching lines across all files. */
  totalMatches: number;
  /** Per-file results. */
  files: GrepFileResult[];
}

export interface GrepFileResult {
  /** Display-relative path. */
  path: string;
  /** Content hash of the full file (for subsequent editing). */
  fileHash: string;
  /** Hashline header for this file snapshot. */
  header: string;
  /** Number of matches in this file. */
  matchCount: number;
}
