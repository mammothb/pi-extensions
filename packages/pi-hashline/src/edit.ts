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
import {
  computeFileHash,
  formatHashlineHeader,
} from "./lib/hashline/format.js";
import { writeFileAtomically } from "./lib/hashline/fs-write.js";
import {
  computeLineHashes,
  formatHashlineRegion,
} from "./lib/hashline/hash.js";
import { Patch, type PatchSection } from "./lib/hashline/input.js";
import {
  HEADTAIL_DRIFT_WARNING,
  missingTagMessage,
  nonExistentFileMessage,
} from "./lib/hashline/messages.js";
import { MismatchError } from "./lib/hashline/mismatch.js";
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
import { Tokenizer } from "./lib/hashline/tokenizer.js";
import type { BlockResolver, Edit } from "./lib/hashline/types.js";
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

const TOKENIZER = new Tokenizer();
/**
 * Extract file paths from hashline headers in edit input text.
 * Handles BOM prefix and quoted paths (defensive — `formatHashlineHeader`
 * never produces quotes). Delegates header detection to the tokenizer.
 */
export function parseHashlineHeaders(input: string): string[] {
  // Strip BOM if present.
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const paths = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const token = TOKENIZER.tokenize(rawLine.trimStart());
    if (token.kind !== "header") {
      continue;
    }

    // Strip optional surrounding quotes (defensive — model may quote paths).
    const unquoted = token.path.replace(/^["'](.+)["']$/, "$1").trim();
    if (unquoted.length > 0) {
      paths.add(unquoted);
    }
  }

  return [...paths];
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
/** Collect anchor lines from already-resolved concrete edits. */
function collectResolvedAnchorLines(edits: readonly Edit[]): number[] {
  const lines = new Set<number>();
  for (const edit of edits) {
    if (edit.kind === "delete") {
      lines.add(edit.anchor.line);
    } else if (
      edit.kind === "insert" &&
      (edit.cursor.kind === "before_anchor" ||
        edit.cursor.kind === "after_anchor")
    ) {
      lines.add(edit.cursor.anchor.line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}
interface PreflightEntry {
  section: PatchSection;
  absPath: string;
  displayPath: string;
  normalized: string;
  lineEnding: "\r\n" | "\n";
  liveHash: string;
  resolvedEdits: readonly Edit[];
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

  const numberedPatch = resolved.map((r) => ({
    old_range: [r.old_range[0].line, r.old_range[1].line] as [number, number],
    new_lines: r.new_lines,
  }));
  const internalEdits = jsonPatchToEdits(numberedPatch);
  const {
    text: newText,
    firstChangedLine,
    warnings: applyWarnings,
  } = applyEdits(normalized, internalEdits);

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
  const allWarnings = [...(applyWarnings ?? []), ...boundaryMsgs];

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

/** Validate JSON format edits: old_range accepts numbers (line) or strings (hash). */
function assertJsonPatch(patch: unknown): asserts patch is HashlineToolEdit[] {
  if (!Array.isArray(patch) || patch.length === 0) {
    throw new Error(
      '[E_BAD_SHAPE] "patch" must be a non-empty array of edit objects.',
    );
  }
  for (let i = 0; i < patch.length; i++) {
    const entry = patch[i] as Record<string, unknown>;
    const range = entry.old_range;
    if (!Array.isArray(range) || range.length !== 2) {
      throw new Error(
        `[E_BAD_SHAPE] Edit ${i}: "old_range" must be a [start, end] pair.`,
      );
    }
    // Accept numbers (line) or strings (hash)
    for (let j = 0; j < 2; j++) {
      const val = range[j];
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
      "Edit files using hashline anchoring. Copy the ¶PATH#TAG header from the read " +
      "tool output and write edit operations (replace, delete, insert) below it. " +
      "The tag validates you are editing the version you read — if the file changed " +
      "since your read, the tool attempts automatic recovery; re-read only on rejection.",
    promptSnippet:
      "Edit files with hashline anchoring — copy ¶PATH#TAG from read/grep/write output",
    promptGuidelines: [
      "Use edit to modify existing files. Copy the ¶PATH#TAG header from your most recent read, grep, or write output — the tag is REQUIRED. Use the write tool to create new files.",
      "After every edit, the file gets a new tag and hash anchors. Always take the next edit's ¶PATH#TAG and hash anchors from the edit response or a fresh read — never reuse old tags.",
      "If the tool returns a stale-tag rejection (automatic recovery failed), STOP and re-read the file. A drift warning means the edit was applied — verify the diff, do not re-read.",
      "Use replace N..M: for changes, delete N..M for removal, insert before/after/head/tail: for additions. Body rows are +TEXT only — no -old rows or bare context lines.",
      'For JSON format: use {"path":"file","patch":[{"old_range":[N,M],"new_lines":["..."]}]}',
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

      // ── Route: text grammar (edits string) ────────────────────────
      const { edits: patchText } = params as { edits?: string };

      // Collect warnings — include text grammar deprecation notice.
      const warnings: string[] = [
        "Text grammar is deprecated. Prefer JSON format: " +
          '{"path":"<file>","patch":[{"old_range":["<HASH>","<HASH>"],"new_lines":["..."]}]}',
      ];
      let patch: Patch;
      try {
        patch = Patch.parse(patchText, { cwd: ctx.cwd });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "invalid edit input";
        return {
          content: [{ type: "text", text: `Edit parse error: ${message}` }],
          details: { files: [], changed: false },
        };
      }

      // 2. Preflight: read all files, validate tags.
      const preflight: PreflightEntry[] = [];

      for (const section of patch.sections) {
        const absPath = resolve(ctx.cwd, section.path);
        const displayPath = resolveDisplayPath(section.path, ctx.cwd);

        // Check file exists.
        let rawContent: string;
        try {
          await access(absPath, constants.R_OK);
          rawContent = await readFile(absPath, "utf-8");
        } catch {
          return {
            content: [
              { type: "text", text: nonExistentFileMessage(displayPath) },
            ],
            details: { files: [], changed: false },
          };
        }

        // Normalize and hash live content.
        const lineEnding = detectLineEnding(rawContent);
        const normalized = normalizeToLF(rawContent);
        const liveHash = computeFileHash(normalized);

        // Resolve any block edits to concrete inserts+deletes
        let resolvedEdits: readonly Edit[];
        try {
          resolvedEdits = resolveBlockEdits(
            section.edits,
            normalized,
            displayPath,
            blockResolver,
            { onUnresolved: "throw" },
          );
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "block resolution failed";
          return {
            content: [{ type: "text", text: `Edit error: ${message}` }],
            details: { files: [], changed: false },
          };
        }
        // Validate tag.
        if (section.fileHash === undefined) {
          return {
            content: [{ type: "text", text: missingTagMessage(displayPath) }],
            details: { files: [], changed: false },
          };
        }

        if (section.fileHash !== liveHash) {
          // Head/tail-only inserts on stale tag: apply with warning.
          if (!section.hasAnchoredEdit) {
            warnings.push(HEADTAIL_DRIFT_WARNING);
            preflight.push({
              section,
              absPath,
              displayPath,
              normalized,
              lineEnding,
              liveHash,
              resolvedEdits,
            });
            continue;
          }

          // Anchored edits on stale tag: reject immediately (no recovery).
          const anchorLines = collectResolvedAnchorLines(resolvedEdits);
          const snapshot = snapshots.byHash(absPath, section.fileHash);
          const error = new MismatchError({
            path: displayPath,
            expectedFileHash: section.fileHash,
            actualFileHash: liveHash,
            fileLines: normalized.split("\n"),
            anchorLines,
            hashRecognized: snapshot !== null,
          });

          return {
            content: [{ type: "text", text: error.displayMessage }],
            details: { files: [], changed: false },
          };
        }

        preflight.push({
          section,
          absPath,
          displayPath,
          normalized,
          lineEnding,
          liveHash,
          resolvedEdits,
        });
      }

      // 3. Apply all edits (atomic — preflight passed for all).
      const fileResults: EditFileResult[] = [];

      for (const pf of preflight) {
        const {
          text: newText,
          firstChangedLine,
          warnings: applyWarnings,
        } = applyEdits(pf.normalized, pf.resolvedEdits);

        // Restore line endings and write atomically.
        const output = restoreLineEndings(newText, pf.lineEnding);
        await writeFileAtomically(pf.absPath, output);
        const newHash = snapshots.record(pf.absPath, newText);
        const header = formatHashlineHeader(pf.displayPath, newHash);
        const resultHashes = computeLineHashes(newText);
        const preview = formatPreview(newText, resultHashes, firstChangedLine);
        const fileWarnings = [
          ...(pf.section.fileHash !== pf.liveHash ? warnings : []),
          ...(applyWarnings ?? []),
        ];

        fileResults.push({
          path: pf.displayPath,
          fileHash: newHash,
          header,
          firstChangedLine,
          warnings: fileWarnings.length > 0 ? fileWarnings : undefined,
          preview,
        });
      }

      // 4. Format the output.
      const outputParts = fileResults.map((fr) => {
        let block = `${fr.header}\n${fr.preview}`;
        if (fr.warnings && fr.warnings.length > 0) {
          block += `\n\nWarnings:\n${fr.warnings.map((w) => `- ${w}`).join("\n")}`;
        }
        return block;
      });

      return {
        content: [{ type: "text", text: outputParts.join("\n\n") }],
        details: {
          files: fileResults,
          changed: fileResults.some((fr) => fr.firstChangedLine !== undefined),
        },
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

      // Text grammar: parse headers for path
      if (typeof args.edits === "string") {
        const paths = parseHashlineHeaders(args.edits);
        let text = theme.fg("toolTitle", theme.bold("Edit "));
        const first = paths[0];
        if (first !== undefined) {
          text += theme.fg("accent", resolveDisplayPath(first, context.cwd));
          if (paths.length > 1) {
            text += theme.fg("dim", ` (+${paths.length - 1} more)`);
          }
        }
        return new Text(text, 0, 0);
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
              : parseHashlineHeaders(
                  (context.args as { edits?: string }).edits ?? "",
                );
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
