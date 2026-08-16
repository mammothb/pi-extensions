import { readFileSync, type Stats, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  createReadToolDefinition,
  type ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import { detectLanguage } from "./lib/tree-sitter/languages.js";
import { parseSymbols as defaultParseSymbols } from "./lib/tree-sitter/parser.js";
import { renderOutline } from "./outline.js";
import type { LanguageId, OutlineSymbol, ReadConfig } from "./types.js";

type BaseReadTool = ReturnType<typeof createReadToolDefinition>;

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

export interface FileStatLike {
  isDirectory: boolean;
  lineCount: number;
  byteLength: number;
}

/**
 * Pure decision function: outline, or delegate to the built-in read?
 * Everything but "large, supported, enabled" delegates.
 */
export function decideRead(
  params: ReadToolInput,
  config: ReadConfig,
  lang: LanguageId | null,
  stat: FileStatLike | null,
): ReadDecision {
  if (!config.enabled) {
    return "delegate";
  }
  if (params.offset !== undefined || params.limit !== undefined) {
    return "delegate";
  }
  if (lang === null || config.languages[lang] === false) {
    return "delegate";
  }
  if (stat === null || stat.isDirectory) {
    return "delegate";
  }
  if (
    stat.lineCount <= config.thresholdLines &&
    stat.byteLength <= config.thresholdBytes
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
 * Build the smart `read` tool: spread the native definition (name, schema,
 * prompt metadata, renderers) and override only `execute`. Fallback paths
 * delegate to a per-cwd native read, preserving exact output shape.
 */
export function createSmartReadTool(deps: SmartReadDeps): BaseReadTool {
  const base = createReadToolDefinition(process.cwd());
  const parse = deps.parseSymbols ?? defaultParseSymbols;

  // Keyed by session cwd — the native read resolves paths against the cwd it
  // was constructed with, so one definition per cwd is required.
  const nativeByCwd = new Map<string, BaseReadTool>();

  function native(cwd: string): BaseReadTool {
    let definition = nativeByCwd.get(cwd);
    if (definition === undefined) {
      definition = createReadToolDefinition(cwd);
      nativeByCwd.set(cwd, definition);
    }
    return definition;
  }

  return {
    ...base,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const delegate = () =>
        native(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);

      const config = deps.getConfig(ctx.cwd);

      // Requirement 4: images/binary → original read (attachments, MIME, etc.).
      if (BINARY_EXTENSIONS.has(extname(params.path).toLowerCase())) {
        return delegate();
      }

      const lang = detectLanguage(params.path);
      if (lang === null) {
        return delegate();
      }
      const absolutePath = resolve(ctx.cwd, params.path);

      let fileStat: Stats;
      try {
        fileStat = statSync(absolutePath);
      } catch {
        return delegate();
      }
      if (fileStat.isDirectory()) {
        return delegate();
      }

      let content: string;
      try {
        content = readFileSync(absolutePath, "utf-8");
      } catch {
        return delegate();
      }

      const lineCount = content.split("\n").length;
      const byteLength = Buffer.byteLength(content, "utf-8");

      if (
        decideRead(params, config, lang, {
          isDirectory: false,
          lineCount,
          byteLength,
        }) === "delegate"
      ) {
        return delegate();
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
