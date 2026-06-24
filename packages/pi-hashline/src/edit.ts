/**
 * Hashline edit tool override.
 *
 * Overrides the built-in `edit` tool to use hashline anchoring. Every edit
 * must include a `¶PATH#TAG` header copied from the most recent `read`
 * output. The tag is validated against the live file before any writes
 * happen — stale tags are rejected with a {@link MismatchError}.
 *
 * Multi-section edits (multiple files in one call) are atomic: all sections
 * are preflighted before any file is written.
 */

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { applyEdits } from "./lib/hashline/apply.js";
import { resolveBlockEdits } from "./lib/hashline/block.js";
import { formatHashlineHeader } from "./lib/hashline/format.js";
import { writeFileAtomically } from "./lib/hashline/fs-write.js";
import {
  computeLineHashes,
  formatHashlineRegion,
} from "./lib/hashline/hash.js";
import { nonExistentFileMessage } from "./lib/hashline/messages.js";
import {
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
} from "./lib/hashline/normalize.js";
import {
  assertNoBareHashPrefixLines,
  formatBoundaryWarnings,
  formatMismatchError,
  type HashlineToolEdit,
  resolveHashlineEdits,
} from "./lib/hashline/resolve.js";
import type { SnapshotStore } from "./lib/hashline/snapshots.js";
import type { BlockResolver, Edit } from "./lib/hashline/types.js";
import { validateSyntax } from "./lib/tree-sitter-block-resolver.js";
import {
  type EditFileResult,
  EditSchema,
  type EditToolDetails,
} from "./schema.js";

// ─── Helpers ─────────────────────────────────────────────────────────

function resolveDisplayPath(rawPath: string, cwd: string): string {
  const resolved = resolve(cwd, rawPath);
  try {
    const rel = relative(cwd, resolved);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      return rel || ".";
    }
  } catch {
    // Fall through.
  }
  return resolved;
}

/** Show up to 20 lines around the first changed line, formatted with hashes. */
function formatPreview(
  text: string,
  lineHashes: string[],
  firstChangedLine?: number,
): string {
  const lines = text.split("\n");
  if (firstChangedLine === undefined) {
    const end = Math.min(lines.length, 10);
    return formatHashlineRegion(lineHashes.slice(0, end), lines.slice(0, end));
  }
  const start = Math.max(0, firstChangedLine - 1 - 5);
  const end = Math.min(lines.length, firstChangedLine - 1 + 15);
  return formatHashlineRegion(
    lineHashes.slice(start, end),
    lines.slice(start, end),
  );
}

// ─── JSON format helpers ───────────────────────────────────────────────
function jsonPatchToEdits(
  patch: Array<{ old_range: [number, number]; new_lines: string[] }>,
): Edit[] {
  const edits: Edit[] = [];
  let idx = 0;
  for (const p of patch) {
    const [start, end] = p.old_range;
    // Replacement inserts (one per new line)
    for (const text of p.new_lines) {
      edits.push({
        kind: "insert",
        cursor: { kind: "before_anchor", anchor: { line: start } },
        text,
        lineNum: start,
        index: idx++,
        mode: "replacement",
      });
    }
    // Deletes for the range being replaced
    for (let i = start; i <= end; i++) {
      edits.push({
        kind: "delete",
        anchor: { line: i },
        lineNum: i,
        index: idx++,
      });
    }
  }
  return edits;
}

/**
 * Execute a JSON-format edit. Supports hash anchors and line numbers in
 * old_range. Hash mismatches are rejected with a diagnostic that includes
 * fresh anchor context.
 */
async function executeJsonEdit(
  absPath: string,
  displayPath: string,
  patch: HashlineToolEdit[],
  snapshots: SnapshotStore,
  blockResolver?: BlockResolver,
): Promise<EditFileResult> {
  // Read file.
  const rawContent = await readFile(absPath, "utf-8");
  const lineEnding = detectLineEnding(rawContent);
  const normalized = normalizeToLF(rawContent);
  const fileLines = normalized.split("\n");
  // Compute per-line hashes for the live file.
  const fileHashes = computeLineHashes(normalized);

  // Reject bare hash prefixes in edit content (Phase 3).
  assertNoBareHashPrefixLines(patch, fileHashes);

  const { resolved, mismatches, boundaryWarnings } = resolveHashlineEdits(
    patch,
    fileHashes,
    fileLines,
  );

  if (mismatches.length > 0) {
    throw new Error(formatMismatchError(mismatches, fileLines, fileHashes));
  }

  // Separate block edits from range edits and resolve them.
  const blockEdits: Edit[] = [];
  const blockPatchEntries = patch.filter((p) => p.block !== undefined);
  for (const bp of blockPatchEntries) {
    const line = bp.block as number;
    blockEdits.push({
      kind: "block",
      anchor: { line },
      payloads: bp.new_lines,
      lineNum: line,
      index: blockEdits.length,
    });
  }
  let resolvedBlockEdits: readonly Edit[] = [];
  if (blockEdits.length > 0) {
    resolvedBlockEdits = resolveBlockEdits(
      blockEdits,
      normalized,
      displayPath,
      blockResolver,
      { onUnresolved: "throw" },
    );
  }

  const rangeEdits = resolved.map((r) => ({
    old_range: [r.old_range[0].line, r.old_range[1].line] as [number, number],
    new_lines: r.new_lines,
  }));
  const internalEdits = [
    ...jsonPatchToEdits(rangeEdits),
    ...resolvedBlockEdits,
  ];
  const {
    text: newText,
    firstChangedLine,
    warnings: applyWarnings,
  } = applyEdits(normalized, internalEdits);

  // Syntax validation (best-effort, tree-sitter may be unavailable).
  const syntaxIssues = validateSyntax(displayPath, newText);
  const syntaxWarnings = syntaxIssues.map(
    (issue) =>
      `Syntax error at line ${issue.line}, column ${issue.column}: ${issue.message}`,
  );

  // Compute line hashes of the result for preview formatting.
  const resultHashes = computeLineHashes(newText);
  const resultLines = newText.split("\n");

  // Format boundary duplication warnings with post-edit hashes (Phase 3).
  const boundaryMsgs = formatBoundaryWarnings(
    boundaryWarnings,
    resultLines,
    resultHashes,
  );

  // Collect all warnings.
  const allWarnings = [
    ...(applyWarnings ?? []),
    ...boundaryMsgs,
    ...syntaxWarnings,
  ];

  // Restore line endings and write atomically.
  const output = restoreLineEndings(newText, lineEnding);
  await writeFileAtomically(absPath, output);

  // Record snapshot.
  const newHash = snapshots.record(absPath, newText);
  const header = formatHashlineHeader(displayPath, newHash);
  const preview = formatPreview(newText, resultHashes, firstChangedLine);

  return {
    path: displayPath,
    fileHash: newHash,
    header,
    firstChangedLine,
    warnings: allWarnings.length ? allWarnings : undefined,
    preview,
  };
}

/** Validate JSON format edits: accepts old_range (hash/line range) or block (line number). */
function assertJsonPatch(patch: unknown): asserts patch is HashlineToolEdit[] {
  if (!Array.isArray(patch) || patch.length === 0) {
    throw new Error(
      '[E_BAD_SHAPE] "patch" must be a non-empty array of edit objects.',
    );
  }
  for (let i = 0; i < patch.length; i++) {
    const entry = patch[i] as Record<string, unknown>;
    const hasRange = entry.old_range !== undefined;
    const hasBlock = entry.block !== undefined;

    if (!hasRange && !hasBlock) {
      throw new Error(
        `[E_BAD_SHAPE] Edit ${i}: must have either "old_range" (a [start, end] pair) or "block" (a line number).`,
      );
    }
    if (hasRange && hasBlock) {
      throw new Error(
        `[E_BAD_SHAPE] Edit ${i}: cannot have both "old_range" and "block".`,
      );
    }

    if (hasRange) {
      const range = entry.old_range;
      if (!Array.isArray(range) || range.length !== 2) {
        throw new Error(
          `[E_BAD_SHAPE] Edit ${i}: "old_range" must be a [start, end] pair.`,
        );
      }
      for (let j = 0; j < 2; j++) {
        const val = (range as unknown[])[j];
        if (typeof val !== "number" && typeof val !== "string") {
          throw new Error(
            `[E_BAD_SHAPE] Edit ${i}: old_range[${j}] must be a number (line) or string (hash).`,
          );
        }
        if (typeof val === "number" && (!Number.isInteger(val) || val < 1)) {
          throw new Error(
            `[E_BAD_SHAPE] Edit ${i}: old_range[${j}] line number must be a positive integer.`,
          );
        }
      }
    }

    if (hasBlock) {
      const block = entry.block;
      if (typeof block !== "number" || !Number.isInteger(block) || block < 1) {
        throw new Error(
          `[E_BAD_SHAPE] Edit ${i}: "block" must be a positive integer (1-indexed line number).`,
        );
      }
    }

    if (!Array.isArray(entry.new_lines)) {
      throw new Error(
        `[E_BAD_SHAPE] Edit ${i}: "new_lines" must be a string array.`,
      );
    }
    for (let j = 0; j < (entry.new_lines as unknown[]).length; j++) {
      if (typeof (entry.new_lines as unknown[])[j] !== "string") {
        throw new Error(
          `[E_BAD_SHAPE] Edit ${i}: new_lines[${j}] must be a string.`,
        );
      }
    }
  }
}

// ─── Tool creator ──────────────────────────────────────────────────────

export function createEditTool(
  snapshots: SnapshotStore,
  blockResolver?: BlockResolver,
): ToolDefinition<typeof EditSchema, EditToolDetails> {
  return {
    name: "edit",
    label: "Edit",
    description:
      "Edit files using hashline anchoring. Copy the \u00b6PATH#TAG header from the read " +
      "tool output and provide edit operations in JSON format. " +
      "The tag validates you are editing the version you read — if the file changed " +
      "since your read, the tool attempts automatic recovery; re-read only on rejection.",
    promptSnippet:
      "Edit files with hashline anchoring — copy ¶PATH#TAG from read/grep/write output",
    promptGuidelines: [
      "Use edit to modify existing files. Copy the ¶PATH#TAG header from your most recent read, grep, or write output — the tag is REQUIRED. Use the write tool to create new files.",
      "After every edit, the file gets a new tag and hash anchors. Always take the next edit's ¶PATH#TAG and hash anchors from the edit response or a fresh read — never reuse old tags.",
      "If the tool returns a stale-tag rejection (automatic recovery failed), STOP and re-read the file. A drift warning means the edit was applied — verify the diff, do not re-read.",
      'Use JSON format: {"path":"<file>","patch":[{"old_range":["<HASH>","<HASH>"],"new_lines":["..."]}]}. old_range accepts 4-char hex HASH anchors from read/grep output, or 1-indexed line numbers. Use {"block": N, "new_lines": [...]} to replace an entire syntactic block (function, if, class, etc). Use [] as new_lines to delete.',
    ],
    parameters: EditSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      // ── Route: JSON format (path + patch) ─────────────────────────
      const jsonPath = (params as Record<string, unknown>).path as
        | string
        | undefined;
      const jsonPatch = (params as Record<string, unknown>).patch as unknown;
      if (jsonPath && jsonPatch !== undefined) {
        try {
          assertJsonPatch(jsonPatch);
          const absPath = resolve(ctx.cwd, jsonPath);
          const displayPath = resolveDisplayPath(jsonPath, ctx.cwd);

          // Check file exists.
          try {
            await access(absPath, constants.R_OK);
          } catch {
            return {
              content: [
                { type: "text", text: nonExistentFileMessage(displayPath) },
              ],
              details: { files: [], changed: false },
            };
          }

          const fileResult = await executeJsonEdit(
            absPath,
            displayPath,
            jsonPatch,
            snapshots,
            blockResolver,
          );

          // Format output with hashline header + preview.
          let outputText = `${fileResult.header}\n${fileResult.preview}`;
          if (fileResult.warnings?.length) {
            outputText += `\n\nWarnings:\n${fileResult.warnings.map((w) => `- ${w}`).join("\n")}`;
          }

          return {
            content: [{ type: "text", text: outputText }],
            details: {
              files: [fileResult],
              changed: fileResult.firstChangedLine !== undefined,
            },
          };
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "invalid JSON edit";
          return {
            content: [{ type: "text", text: `Edit error: ${message}` }],
            details: { files: [], changed: false },
          };
        }
      }

      // No valid edit input provided.
      return {
        content: [
          {
            type: "text",
            text: 'Edit error: provide "path" and "patch" in JSON format.',
          },
        ],
        details: { files: [], changed: false },
      };
    },

    renderCall(args, theme, context) {
      // JSON format: show the path
      const jsonPath = (args as Record<string, unknown>).path as
        | string
        | undefined;
      if (typeof jsonPath === "string") {
        return new Text(
          theme.fg("toolTitle", theme.bold("Edit ")) +
            theme.fg("accent", resolveDisplayPath(jsonPath, context.cwd)),
          0,
          0,
        );
      }

      return new Text(
        theme.fg("toolTitle", theme.bold("Edit ")) +
          theme.fg("dim", "(no input)"),
        0,
        0,
      );
    },

    renderResult(result, _options, theme, context) {
      const details = result.details as EditToolDetails;
      const isReturnedError = details.files.length === 0 && !details.changed;
      const isError = context.isError || isReturnedError;

      if (isError) {
        const errorText =
          result.content[0]?.type === "text"
            ? result.content[0].text
            : "Edit failed";
        const jsonPath = (context.args as Record<string, unknown>).path as
          | string
          | undefined;
        const paths =
          details.files.length > 0
            ? details.files.map((f) => f.path)
            : jsonPath
              ? [jsonPath]
              : [];
        const firstPath = paths.length > 0 ? paths[0] : undefined;
        const first =
          firstPath !== undefined ? theme.fg("accent", firstPath) : "";
        return new Text(
          theme.fg("error", "✗ ") +
            theme.fg("toolTitle", theme.bold("Edit ")) +
            first +
            "\n" +
            theme.fg("error", errorText),
          0,
          0,
        );
      }

      // Success path.
      const files = details.files;
      const prefix =
        theme.fg("success", "✓ ") + theme.fg("toolTitle", theme.bold("Edit "));

      if (files.length === 0) {
        return new Text(prefix, 0, 0);
      }

      const firstFile = files[0] as EditFileResult;
      let text =
        prefix +
        theme.fg("accent", resolveDisplayPath(firstFile.path, context.cwd));
      if (files.length > 1) {
        text += theme.fg("dim", ` (+${files.length - 1} more)`);
      }

      const changedFiles = files.filter(
        (f) => f.firstChangedLine !== undefined,
      );
      if (changedFiles.length > 0) {
        text +=
          " " +
          theme.fg(
            "dim",
            `(${changedFiles.length} file${changedFiles.length > 1 ? "s" : ""} changed)`,
          );
      }

      return new Text(text, 0, 0);
    },
  };
}
