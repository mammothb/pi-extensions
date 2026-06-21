/**
 * Hashline read tool override.
 *
 * Overrides the built-in `read` tool to emit `\u00b6PATH#TAG` headers and
 * record content snapshots. Text files get tagged; images delegate to the
 * native read implementation.
 */

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import {
  createReadToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  computeFileHash,
  formatHashlineHeader,
} from "./lib/hashline/format.js";
import {
  computeLineHashes,
  formatHashlineRegion,
} from "./lib/hashline/hash.js";
import type { SnapshotStore } from "./lib/hashline/snapshots.js";
import { ReadSchema, type ReadToolDetails } from "./schema.js";

const DEFAULT_MAX_BYTES = 50 * 1024;

/** File extensions handled by the native read tool (images, etc.). */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tiff",
  ".tif",
  ".svg",
]);

/**
 * Resolve a user-provided path relative to cwd.
 * Returns a display-friendly relative path when within cwd.
 */
function resolvePath(rawPath: string, cwd: string): string {
  const resolved = resolve(cwd, rawPath);
  try {
    const rel = relative(cwd, resolved);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      return rel || ".";
    }
  } catch {
    // Fall through — use absolute path.
  }
  return resolved;
}

function errorResult(message: string): {
  content: { type: "text"; text: string }[];
  details: ReadToolDetails;
} {
  return {
    content: [{ type: "text", text: message }],
    details: {
      totalLines: 0,
      totalBytes: 0,
      truncated: false,
      fileHash: "",
      header: "",
    },
  };
}

export function createReadTool(
  snapshots: SnapshotStore,
): ToolDefinition<typeof ReadSchema, ReadToolDetails> {
  // Lazily create the native read tool so we can delegate image/file-not-found
  // handling to it. Created once per session on first delegate call.
  let _nativeRead: ToolDefinition<typeof ReadSchema, unknown> | undefined;

  function nativeRead(ctx: {
    cwd: string;
  }): ToolDefinition<typeof ReadSchema, unknown> {
    if (!_nativeRead) {
      _nativeRead = createReadToolDefinition(ctx.cwd) as ToolDefinition<
        typeof ReadSchema,
        unknown
      >;
    }
    return _nativeRead;
  }

  return {
    name: "read",
    label: "Read",
    description:
      "Read the contents of a file. Supports text files and images (jpg, png, gif, webp). " +
      "Every text file view includes a \u00b6PATH#TAG header — copy this tag when editing " +
      "the file so the edit tool can validate you're working against the current version.",
    promptSnippet:
      "Read file contents — every output includes a \u00b6PATH#TAG header required by the edit tool",
    promptGuidelines: [
      "Use read to inspect file content instead of cat or tail. Every text output starts with a \u00b6PATH#TAG header — copy the entire header (including the tag) into edit tool calls to validate you're editing the current file version.",
      "Use offset/limit to read large files in sections. Tags are per-file, not per-section — any section of a file carries the same tag.",
    ],
    parameters: ReadSchema,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { path: rawPath } = params;
      const absolutePath = resolve(ctx.cwd, rawPath);

      // Delegate to native read for images and SVGs.
      const ext = extname(absolutePath).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        // Native read details type differs from hashline. Safe cast.
        // biome-ignore lint/suspicious/noExplicitAny: native tool type mismatch in override
        const onUpdateCast = onUpdate as any;
        const result = nativeRead(ctx).execute(
          toolCallId,
          params,
          signal,
          onUpdateCast,
          ctx,
        );
        // biome-ignore lint/suspicious/noExplicitAny: native tool type mismatch in override
        return result as any;
      }

      // Check readability.
      try {
        await access(absolutePath, constants.R_OK);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown error";
        return errorResult(`Cannot read file: ${message}`);
      }

      // Text file — read fully, compute hash, record snapshot, format output.
      try {
        const rawContent = await readFile(absolutePath, "utf-8");
        const totalBytes = Buffer.byteLength(rawContent, "utf-8");

        // Normalize to LF for line counting and hash computation.
        const normalized = rawContent.replace(/\r\n/g, "\n");

        // Split into lines. A trailing newline produces an empty string at
        // the end — strip it for display purposes (it's a line terminator,
        // not a blank line).
        const rawLines = normalized.split("\n");
        if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
          rawLines.pop();
        }
        const allLines = rawLines;
        const totalLines = allLines.length;

        // Compute file-level hash for snapshot tag.
        const fileHash = computeFileHash(normalized);

        // Compute per-line content hashes for the entire file.
        const allLineHashes = computeLineHashes(normalized);

        // Record snapshot (keyed by absolute path for consistency).
        snapshots.record(absolutePath, normalized);

        const displayPath = resolvePath(rawPath, ctx.cwd);
        const header = formatHashlineHeader(displayPath, fileHash);

        // Apply offset and limit.
        const startLine = params.offset ? Math.max(0, params.offset - 1) : 0;
        const endLine = params.limit
          ? startLine + params.limit
          : allLines.length;
        const selectedLines = allLines.slice(startLine, endLine);
        const selectedHashes = allLineHashes.slice(startLine, endLine);

        // Format with hashline header + hash-anchored lines.
        let formatted = `${header}\n${formatHashlineRegion(selectedHashes, selectedLines)}`;
        let truncated = false;

        // Truncate at 50KB, preserving complete hashline-formatted lines.
        const formattedBytes = Buffer.byteLength(formatted, "utf-8");
        if (formattedBytes > DEFAULT_MAX_BYTES) {
          const formattedLines = formatted.split("\n");
          // First line is the ¶PATH#TAG header — always keep it.
          let kept = formattedLines[0] as string;
          for (let i = 1; i < formattedLines.length; i++) {
            const candidate = `${kept}\n${formattedLines[i] as string}`;
            if (Buffer.byteLength(candidate, "utf-8") > DEFAULT_MAX_BYTES) {
              truncated = true;
              break;
            }
            kept = candidate;
          }
          formatted = `${kept}\n\n[Output truncated at 50KB. Use offset/limit to read specific sections.]`;
        }

        return {
          content: [{ type: "text", text: formatted }],
          details: {
            totalLines,
            totalBytes,
            truncated,
            fileHash,
            header,
          } satisfies ReadToolDetails,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown error";
        return errorResult(`Error reading file: ${message}`);
      }
    },
  };
}
