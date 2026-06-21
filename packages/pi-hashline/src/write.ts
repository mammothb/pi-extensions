/**
 * Hashline write tool override.
 *
 * Overrides the built-in `write` tool to record content snapshots so the
 * agent can immediately `edit` the newly created file with a hashline tag.
 * The result includes a `\u00b6PATH#TAG` header matching the read tool output
 * format.
 *
 * Auto-strips hashline display prefixes when the model accidentally copies
 * `\u00b6PATH#HASH` headers and `LINE:` prefixes from read output into write
 * content.
 */

import { isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  computeFileHash,
  formatHashlineHeader,
} from "./lib/hashline/format.js";
import { writeFileAtomically } from "./lib/hashline/fs-write.js";
import {
  computeLineHashes,
  formatHashlineRegion,
} from "./lib/hashline/hash.js";
import { normalizeToLF } from "./lib/hashline/normalize.js";
import { stripHashlinePrefixes } from "./lib/hashline/prefixes.js";
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

// -- Prefix stripping ---------------------------------------------------

const LOOSE_HASHLINE_HEADER_RE = /^\s*¶\S+#[^\t\r\n]*\s*$/;

function stripWriteContent(content: string): {
  text: string;
  stripped: boolean;
} {
  const lines = content.split("\n");
  const cleaned = stripHashlinePrefixes(lines);
  if (cleaned !== lines) {
    return { text: cleaned.join("\n"), stripped: true };
  }

  const headerIndex = lines.findIndex((l) => l.trim().length > 0);
  if (
    headerIndex === -1 ||
    !LOOSE_HASHLINE_HEADER_RE.test(lines[headerIndex] as string)
  ) {
    return { text: content, stripped: false };
  }

  const withoutHeader = [
    ...lines.slice(0, headerIndex),
    ...lines.slice(headerIndex + 1),
  ];
  const cleanedWithout = stripHashlinePrefixes(withoutHeader);
  if (cleanedWithout === withoutHeader) {
    return { text: content, stripped: false };
  }
  return { text: cleanedWithout.join("\n"), stripped: true };
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

      // Strip hashline display prefixes if present.
      const { text: stripped, stripped: wasStripped } =
        stripWriteContent(content);

      // Write atomically (temp file + rename).
      await writeFileAtomically(absPath, stripped);

      // Normalize to LF for consistent hashing.
      const normalized = normalizeToLF(stripped);

      // Compute hash and record snapshot from stripped content.
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

      // Compute per-line hashes and format with hash-anchored prefixes.
      const lineHashes = computeLineHashes(normalized);
      const displayHashes = lineHashes.slice(0, allLines.length);
      let output = `${header}\n${formatHashlineRegion(displayHashes, allLines)}`;
      if (wasStripped) {
        output +=
          "\nNote: auto-stripped hashline display prefixes from content before writing.";
      }

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
