/**
 * Hashline grep tool override.
 *
 * Overrides the built-in `grep` tool to emit `¶PATH#TAG` headers for each
 * file with matches. Uses ripgrep (`rg --json`) for fast, gitignore-aware
 * search. After finding matches, reads each matching file to compute its
 * content hash and record a snapshot — so the agent can immediately `edit`
 * files found via grep without re-reading them.
 */

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { computeFileHash, formatHashlineHeader } from "./format";
import { normalizeToLF } from "./normalize";
import type { SnapshotStore } from "./snapshots";

// ─── Schema ──────────────────────────────────────────────────────────

const GrepSchema = Type.Object({
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

// ─── Details type ────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_FILES = 50;
const MAX_CONCURRENT_READS = 8;
const GREP_MAX_LINE_LENGTH = 500;

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

// ─── rg invocation ───────────────────────────────────────────────────

interface RgMatch {
  path: string;
  lineNumber: number;
  line: string;
  /** True if this is an actual match, false for context lines emitted by rg. */
  isMatch: boolean;
}

interface RgFile {
  path: string;
  matches: RgMatch[];
  /** Full file content (lines), populated when context > 0 or for hashing. */
  contentLines?: string[];
}

interface RgOptions {
  glob?: string;
  context?: number;
  ignoreCase?: boolean;
  literal?: boolean;
}

/**
 * Run `rg --json` and parse the output into per-file match groups.
 */
function runRg(
  pattern: string,
  searchPath: string,
  opts: RgOptions = {},
  signal?: AbortSignal,
): Promise<{ files: RgFile[]; truncated: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const args = ["--json", "--no-heading", "--with-filename", "--no-messages"];

    if (opts.ignoreCase) {
      args.push("--ignore-case");
    }
    if (opts.literal) {
      args.push("--fixed-strings");
    }
    if (opts.glob) {
      args.push("--glob", opts.glob);
    }
    if (opts.context && opts.context > 0) {
      args.push("-A", String(opts.context), "-B", String(opts.context));
    }

    args.push(pattern, searchPath);

    const child = spawn("rg", args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });

    const files = new Map<string, RgFile>();
    let totalBytes = 0;
    let truncated = false;

    const ensureFile = (filePath: string): RgFile => {
      let file = files.get(filePath);
      if (file === undefined) {
        file = { path: filePath, matches: [] };
        files.set(filePath, file);
      }
      return file;
    };

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");

      // Process complete lines.
      let newlineIdx = stdout.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = stdout.slice(0, newlineIdx);
        stdout = stdout.slice(newlineIdx + 1);

        if (totalBytes >= DEFAULT_MAX_BYTES) {
          truncated = true;
          child.kill();
          return;
        }
        totalBytes += Buffer.byteLength(line, "utf-8");

        try {
          const event = JSON.parse(line);
          if (event.type === "match" || event.type === "context") {
            const filePath = event.data.path.text;
            const file = ensureFile(filePath);
            if (files.size > DEFAULT_MAX_FILES) {
              truncated = true;
              child.kill();
              return;
            }
            file.matches.push({
              path: filePath,
              lineNumber: event.data.line_number,
              line: event.data.lines.text.replace(/\n$/, ""),
              isMatch: event.type === "match",
            });
          }
        } catch {
          // Skip lines that aren't valid JSON (e.g., partial writes).
        }
        newlineIdx = stdout.indexOf("\n");
      }
    });

    child.on("close", (code) => {
      // code 0 = matches found, code 1 = no matches, code >1 = error
      if (code !== null && code > 1) {
        reject(new Error(`rg exited with code ${code}`));
        return;
      }
      resolvePromise({
        files: [...files.values()],
        truncated,
      });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

// ─── Tool creator ────────────────────────────────────────────────────

export function createGrepTool(
  snapshots: SnapshotStore,
): ToolDefinition<typeof GrepSchema, GrepToolDetails> {
  return {
    name: "grep",
    label: "Grep",
    description:
      "Search file contents using ripgrep. Results include ¶PATH#TAG headers " +
      "so you can immediately edit matching files without re-reading them. " +
      "Requires ripgrep (rg) to be installed.",
    promptSnippet:
      "Search file contents — matching files get ¶PATH#TAG headers for immediate editing",
    promptGuidelines: [
      "Use grep to find code by pattern. Every matching file starts with a ¶PATH#TAG header — use that tag to edit the file without re-reading it. Use read if you need to see the full file content around the match.",
      "Use glob to filter by file extension (e.g. '*.ts'), context to show surrounding lines, ignoreCase for case-insensitive search, and literal to match a fixed string instead of regex.",
    ],
    parameters: GrepSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const {
        pattern,
        path: rawPath,
        glob,
        context,
        ignoreCase,
        literal,
      } = params;
      const searchPath = rawPath ? resolve(ctx.cwd, rawPath) : ctx.cwd;
      const contextValue = context ?? 0;

      // 1. Run ripgrep.
      let rgFiles: RgFile[];
      let truncated: boolean;
      try {
        const result = await runRg(
          pattern,
          searchPath,
          { glob, context: contextValue, ignoreCase, literal },
          signal,
        );
        rgFiles = result.files;
        truncated = result.truncated;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown error";
        return {
          content: [
            {
              type: "text",
              text:
                `Grep error: ${message}. ` +
                "Make sure ripgrep (rg) is installed: " +
                "`brew install ripgrep` (macOS) or `apt install ripgrep` (Linux).",
            },
          ],
          details: {
            filesWithMatches: 0,
            totalMatches: 0,
            files: [],
          },
        };
      }

      if (rgFiles.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matches found for pattern: ${pattern}`,
            },
          ],
          details: {
            filesWithMatches: 0,
            totalMatches: 0,
            files: [],
          },
        };
      }

      // 2. Read each matching file to compute hashes (parallel, limited concurrency).
      const fileResults: GrepFileResult[] = [];
      let totalMatches = 0;

      // Process files in batches to limit concurrent I/O.
      for (let i = 0; i < rgFiles.length; i += MAX_CONCURRENT_READS) {
        const batch = rgFiles.slice(i, i + MAX_CONCURRENT_READS);
        const batchResults = await Promise.all(
          batch.map(async (rgFile) => {
            const absPath = resolve(ctx.cwd, rgFile.path);
            try {
              await access(absPath, constants.R_OK);
              const rawContent = await readFile(absPath, "utf-8");
              const normalized = normalizeToLF(rawContent);
              const fileHash = computeFileHash(normalized);
              snapshots.record(absPath, normalized);
              const displayPath = resolveDisplayPath(rgFile.path, ctx.cwd);

              // Store content lines for context display.
              if (contextValue > 0) {
                const lines = normalized.split("\n");
                rgFile.contentLines = lines;
              }

              return {
                rgFile,
                displayPath,
                fileHash,
                header: formatHashlineHeader(displayPath, fileHash),
              };
            } catch {
              // File became unreadable between rg and now — skip it.
              return null;
            }
          }),
        );

        for (const result of batchResults) {
          if (result === null) continue;
          totalMatches += result.rgFile.matches.filter((m) => m.isMatch).length;
          fileResults.push({
            path: result.displayPath,
            fileHash: result.fileHash,
            header: result.header,
            matchCount: result.rgFile.matches.length,
          });
        }
      }

      // 3. Format output: ¶PATH#TAG header + numbered match lines (with optional context).
      const parts: string[] = [];

      for (let fi = 0; fi < fileResults.length; fi++) {
        const fr = fileResults[fi];
        if (fr === undefined) {
          continue;
        }
        const rgFile = rgFiles.find(
          (f) => f.path.endsWith(fr.path) || fr.path.endsWith(f.path),
        );

        parts.push(fr.header);

        if (rgFile !== undefined) {
          if (contextValue > 0 && rgFile.contentLines) {
            // Context mode: show surrounding lines for each match.
            const lines = rgFile.contentLines;
            const actualMatches = rgFile.matches.filter((m) => m.isMatch);
            const shown = new Set<number>();

            for (const match of actualMatches) {
              const start = Math.max(1, match.lineNumber - contextValue);
              const end = Math.min(
                lines.length,
                match.lineNumber + contextValue,
              );

              for (let l = start; l <= end; l++) {
                if (shown.has(l)) continue;
                shown.add(l);
                const text = (lines[l - 1] ?? "").slice(
                  0,
                  GREP_MAX_LINE_LENGTH,
                );
                const isActualMatch = actualMatches.some(
                  (am) => am.lineNumber === l,
                );
                if (isActualMatch) {
                  parts.push(`${l}:${text}`);
                } else {
                  parts.push(`${l}- ${text}`);
                }
              }

              // Separator between match blocks.
              if (match !== actualMatches[actualMatches.length - 1]) {
                parts.push("--");
              }
            }
          } else {
            // Flat mode: just show match lines.
            for (const match of rgFile.matches) {
              const text = match.line.slice(0, GREP_MAX_LINE_LENGTH);
              parts.push(`${match.lineNumber}:${text}`);
            }
          }
        }

        // Add blank line between files for readability.
        if (fi < fileResults.length - 1) {
          parts.push("");
        }
      }

      let output = parts.join("\n");

      // Truncate if too large.
      const outputBytes = Buffer.byteLength(output, "utf-8");
      if (outputBytes > DEFAULT_MAX_BYTES) {
        output =
          output.slice(0, DEFAULT_MAX_BYTES) +
          "\n\n[Output truncated at 50KB. Narrow your search pattern or path.]";
        truncated = true;
      }

      if (truncated) {
        output +=
          "\n[Search truncated. Use a more specific pattern or narrower path.]";
      }

      return {
        content: [{ type: "text", text: output }],
        details: {
          filesWithMatches: fileResults.length,
          totalMatches,
          files: fileResults,
        },
      };
    },
  };
}
