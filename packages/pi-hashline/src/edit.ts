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
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { applyEdits } from "./lib/hashline/apply.js";
import {
  computeFileHash,
  formatHashlineHeader,
  formatNumberedLines,
} from "./lib/hashline/format.js";
import { Patch, type PatchSection } from "./lib/hashline/input.js";
import {
  HEADTAIL_DRIFT_WARNING,
  MismatchError,
  missingTagMessage,
  nonExistentFileMessage,
  unrecognizedHashMessage,
} from "./lib/hashline/messages.js";
import {
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
} from "./lib/hashline/normalize.js";
import { tryRecover } from "./lib/hashline/recovery.js";
import type { SnapshotStore } from "./lib/hashline/snapshots.js";
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

/** Show up to 20 lines around the first changed line. */
function formatPreview(text: string, firstChangedLine?: number): string {
  if (firstChangedLine === undefined) {
    return formatNumberedLines(text.split("\n").slice(0, 10).join("\n"), 1);
  }
  const lines = text.split("\n");
  const start = Math.max(0, firstChangedLine - 1 - 5);
  const end = Math.min(lines.length, firstChangedLine - 1 + 15);
  return formatNumberedLines(lines.slice(start, end).join("\n"), start + 1);
}

// ─── Preflight result ────────────────────────────────────────────────

interface PreflightEntry {
  section: PatchSection;
  absPath: string;
  displayPath: string;
  normalized: string;
  lineEnding: "\r\n" | "\n";
  liveHash: string;
}

// ─── Tool creator ────────────────────────────────────────────────────

export function createEditTool(
  snapshots: SnapshotStore,
): ToolDefinition<typeof EditSchema, EditToolDetails> {
  return {
    name: "edit",
    label: "Edit",
    description:
      "Edit files using hashline anchoring. Copy the ¶PATH#TAG header from the read " +
      "tool output and write edit operations (replace, delete, insert) below it. " +
      "The tag validates you're editing the version you read — stale tags are rejected " +
      "so you must re-read the file if it changed.",
    promptSnippet:
      "Edit files with hashline anchoring — copy ¶PATH#TAG from read/grep/write output",
    promptGuidelines: [
      "Use edit to modify existing files. Copy the ¶PATH#TAG header from your most recent read, grep, or write output — the tag is REQUIRED. Use the write tool to create new files.",
      "After every edit, the file gets a new tag and renumbered lines. Always take the next edit's ¶PATH#TAG and line numbers from the edit response or a fresh read — never reuse old tags.",
      "On a stale-tag rejection (file changed between read and edit), STOP and re-read the file. Never stack more edits onto stale numbers.",
      "Use replace N..M: for changes, delete N..M for removal, insert before/after/head/tail: for additions. Body rows are +TEXT only — no -old rows or bare context lines.",
    ],
    parameters: EditSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { edits: patchText } = params;

      // 1. Parse the patch input.
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
      const warnings: string[] = [];

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
            });
            continue;
          }

          // Anchored edits on stale tag: try recovery first.
          const anchorLines = section.collectAnchorLines();
          const recovered = tryRecover(
            snapshots,
            absPath,
            normalized,
            section.fileHash,
            section.edits,
            anchorLines,
          );

          if (recovered !== null) {
            // Recovery succeeded — use recovered text as the base.
            warnings.push(recovered.warning);
            preflight.push({
              section,
              absPath,
              displayPath,
              normalized: recovered.text,
              lineEnding,
              liveHash: computeFileHash(recovered.text),
            });
            continue;
          }

          // Recovery failed.
          const snapshot = snapshots.byHash(absPath, section.fileHash);
          if (snapshot === null) {
            return {
              content: [
                {
                  type: "text",
                  text: unrecognizedHashMessage(section.fileHash),
                },
              ],
              details: { files: [], changed: false },
            };
          }

          throw new MismatchError(
            displayPath,
            section.fileHash,
            liveHash,
            normalized,
            anchorLines,
          );
        }

        preflight.push({
          section,
          absPath,
          displayPath,
          normalized,
          lineEnding,
          liveHash,
        });
      }

      // 3. Apply all edits (atomic — preflight passed for all).
      const fileResults: EditFileResult[] = [];

      for (const pf of preflight) {
        const {
          text: newText,
          firstChangedLine,
          warnings: applyWarnings,
        } = applyEdits(pf.normalized, pf.section.edits);

        // Restore line endings and write.
        const output = restoreLineEndings(newText, pf.lineEnding);
        await mkdir(dirname(pf.absPath), { recursive: true });
        await writeFile(pf.absPath, output, "utf-8");

        // Record fresh snapshot.
        const newHash = snapshots.record(pf.absPath, newText);
        const header = formatHashlineHeader(pf.displayPath, newHash);
        const preview = formatPreview(newText, firstChangedLine);

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
  };
}
