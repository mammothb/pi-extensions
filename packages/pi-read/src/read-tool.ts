import type { Stats } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { detectLanguage } from "./lib/tree-sitter/languages.js";
import { parseSymbols as defaultParseSymbols } from "./lib/tree-sitter/parser.js";
import { renderOutline } from "./outline.js";
import type { LanguageId, OutlineSymbol, ReadConfig } from "./types.js";

type BaseReadTool = ReturnType<typeof createReadToolDefinition>;

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Resolve a path the way the built-in read does, for the subset we need:
 * `~` expansion, leading-`@` stripping, and unicode-space normalization, then
 * resolve against cwd. (macOS NFD/curly-quote/AM-PM fallbacks are skipped —
 * this targets Ubuntu.)
 */
function resolveReadPath(filePath: string, cwd: string): string {
  let path = filePath.replace(UNICODE_SPACES, " ");
  if (path.startsWith("@")) {
    path = path.slice(1);
  }
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return resolve(cwd, path);
}

/**
 * Extensions we never attempt to outline. The built-in read handles images
 * (returns them as attachments) and arbitrary binary content; we pass them
 * straight through.
 */
const BINARY_EXTENSIONS = new Set([
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
  ".pdf",
]);

export type ReadDecision = "delegate" | "outline";

/**
 * Pure decision function: outline, or delegate? Only the threshold check
 * needs file content, so the cheap guards (enabled, offset/limit, language)
 * live in `execute`, ahead of the filesystem read.
 */
export function decideRead(
  config: ReadConfig,
  lineCount: number,
  byteLength: number,
): ReadDecision {
  if (
    lineCount <= config.thresholdLines &&
    byteLength <= config.thresholdBytes
  ) {
    return "delegate";
  }
  return "outline";
}

export interface SmartReadDeps {
  getConfig: (cwd: string) => ReadConfig;
  parseSymbols?: (id: LanguageId, source: string) => Promise<OutlineSymbol[]>;
}

/**
 * Build the smart `read` tool: spread the built-in definition (name, schema,
 * prompt metadata, renderers) and override only `execute`. Fallback paths
 * delegate to a per-cwd built-in read, preserving exact output shape.
 */
export function createSmartReadTool(deps: SmartReadDeps): BaseReadTool {
  // The cwd here is a no-op: it's only consumed by `execute`, which we
  // override below, and the renderers read `context.cwd`. `base` is spread
  // solely for name/schema/prompt metadata and the built-in renderers.
  const base = createReadToolDefinition(process.cwd());
  const parse = deps.parseSymbols ?? defaultParseSymbols;

  // Cache a single built-in read definition for the current cwd — the built-in
  // read resolves paths against the cwd it was constructed with, and a session
  // only ever uses one cwd, so a bounded single-entry cache is enough.
  let builtinCwd: string | undefined;
  let builtinDefinition: BaseReadTool | undefined;

  function builtinRead(cwd: string): BaseReadTool {
    if (builtinCwd !== cwd || builtinDefinition === undefined) {
      builtinCwd = cwd;
      builtinDefinition = createReadToolDefinition(cwd);
    }
    return builtinDefinition;
  }

  return {
    ...base,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const delegate = () =>
        builtinRead(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);

      const config = deps.getConfig(ctx.cwd);

      // Cheap guards first — before any filesystem access.
      if (!config.enabled) {
        return delegate();
      }
      if (params.offset !== undefined || params.limit !== undefined) {
        return delegate();
      }

      // Requirement 4: images/binary → original read (attachments, MIME, etc.).
      if (BINARY_EXTENSIONS.has(extname(params.path).toLowerCase())) {
        return delegate();
      }

      const lang = detectLanguage(params.path);
      if (lang === null || config.languages[lang] === false) {
        return delegate();
      }
      const absolutePath = resolveReadPath(params.path, ctx.cwd);

      let fileStat: Stats;
      try {
        fileStat = await stat(absolutePath);
      } catch {
        return delegate();
      }
      if (fileStat.isDirectory()) {
        return delegate();
      }
      // Hard safety cap — don't slurp + parse files beyond this; the built-in
      // read truncates at 50KB and a multi-GB file would OOM here.
      if (fileStat.size > config.maxBytes) {
        return delegate();
      }

      let content: string;
      try {
        const buffer = await readFile(absolutePath);
        // A NUL byte marks binary content (e.g. an image mislabeled with a
        // code extension) — delegate so the built-in read MIME-sniffs it.
        if (buffer.includes(0)) {
          return delegate();
        }
        content = buffer.toString("utf-8");
      } catch {
        return delegate();
      }

      const lineCount = content.split("\n").length;
      const byteLength = Buffer.byteLength(content, "utf-8");

      if (decideRead(config, lineCount, byteLength) === "delegate") {
        return delegate();
      }

      // Re-check before the WASM parse: a signal that fired during the
      // synchronous read is only observable once the event loop resumes.
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      try {
        const symbols = await parse(lang, content);
        if (symbols.length === 0) {
          // No grammar / parse failure → keep original behavior.
          return delegate();
        }
        const outline = renderOutline(symbols, {
          maxDepth: config.maxDepth,
          totalLines: lineCount,
          fileLabel: params.path,
          languageLabel: lang,
        });
        return {
          content: [{ type: "text", text: outline }],
          details: undefined,
        };
      } catch {
        return delegate();
      }
    },
  };
}
