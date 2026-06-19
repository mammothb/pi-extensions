/**
 * Hashline write tool override.
 *
 * Overrides the built-in `write` tool to record content snapshots so the
 * agent can immediately `edit` the newly created file with a hashline tag.
 * The result includes a `\u00b6PATH#TAG` header matching the read tool output
 * format.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  computeFileHash,
  formatHashlineHeader,
  formatNumberedLines,
} from "./lib/hashline/format.js";
import { normalizeToLF } from "./lib/hashline/normalize.js";
import type { SnapshotStore } from "./lib/hashline/snapshots.js";
import { WriteSchema, type WriteToolDetails } from "./schema.js";

// -- Helpers ------------------------------------------------------------

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

// -- Tool creator -------------------------------------------------------

export function createWriteTool(
  snapshots: SnapshotStore,
): ToolDefinition<typeof WriteSchema, WriteToolDetails> {
  return {
    name: "write",
    label: "Write",
    description:
      "Create or overwrite a file. The result includes a \u00b6PATH#TAG header — " +
      "copy this tag when editing the file so the edit tool can validate " +
      "you're working against the current version.",
    promptSnippet:
      "Create or overwrite files — returns a \u00b6PATH#TAG header for immediate editing",
    promptGuidelines: [
      "Use write to create new files or completely overwrite existing ones. The result includes a \u00b6PATH#TAG header — use this tag to edit the file immediately without re-reading.",
    ],
    parameters: WriteSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { path: rawPath, content } = params;
      const absPath = resolve(ctx.cwd, rawPath);
      const displayPath = resolveDisplayPath(rawPath, ctx.cwd);

      // Create parent directories.
      await mkdir(dirname(absPath), { recursive: true });

      // Write content to disk.
      await writeFile(absPath, content, "utf-8");

      // Normalize to LF for consistent hashing.
      const normalized = normalizeToLF(content);

      // Compute hash and record snapshot.
      const fileHash = computeFileHash(normalized);
      snapshots.record(absPath, normalized);

      const header = formatHashlineHeader(displayPath, fileHash);

      // Count lines (strip trailing empty line from trailing newline).
      const rawLines = normalized.split("\n");
      if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
        rawLines.pop();
      }
      const allLines = rawLines;
      const totalLines = allLines.length;

      // Format output matching read tool format.
      const output = `${header}\n${formatNumberedLines(allLines.join("\n"), 1)}`;

      return {
        content: [{ type: "text", text: output }],
        details: {
          totalLines,
          fileHash,
          header,
        } satisfies WriteToolDetails,
      };
    },
  };
}
