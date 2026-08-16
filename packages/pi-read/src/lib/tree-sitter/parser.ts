import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Language } from "web-tree-sitter";
import type { LanguageId, OutlineSymbol } from "../../types.js";
import { GRAMMARS } from "./languages.js";
import { collectSymbols } from "./symbols.js";

const require = createRequire(import.meta.url);

type WebTreeSitter = typeof import("web-tree-sitter");

/** Lazily load + init the web-tree-sitter runtime. Null when not installed. */
let runtimePromise: Promise<WebTreeSitter | null> | undefined;

function loadRuntime(): Promise<WebTreeSitter | null> {
  if (runtimePromise === undefined) {
    runtimePromise = (async () => {
      try {
        const mod = await import("web-tree-sitter");
        await mod.Parser.init();
        return mod;
      } catch {
        console.warn(
          "[pi-read] web-tree-sitter not installed — AST outlining disabled.",
        );
        return null;
      }
    })();
  }
  return runtimePromise;
}

const grammarCache = new Map<LanguageId, Language | null>();

/**
 * Load a language's grammar `.wasm` from its optional npm package.
 * Returns null when the runtime or the grammar package is unavailable.
 */
export async function loadGrammar(id: LanguageId): Promise<Language | null> {
  const cached = grammarCache.get(id);
  if (cached !== undefined) {
    return cached;
  }

  const spec = GRAMMARS.find((g) => g.id === id);
  const mod = await loadRuntime();
  if (spec === undefined || mod === null) {
    grammarCache.set(id, null);
    return null;
  }

  try {
    const wasmPath = require.resolve(`${spec.package}/${spec.wasmFile}`);
    const language = await mod.Language.load(readFileSync(wasmPath));
    grammarCache.set(id, language);
    return language;
  } catch {
    console.warn(
      `[pi-read] grammar for ${id} unavailable — outlining disabled.`,
    );
    grammarCache.set(id, null);
    return null;
  }
}

/**
 * Parse a source file into structural symbols.
 * Returns [] when the runtime/grammar is unavailable or parsing fails, so the
 * read tool delegates to the built-in read.
 */
export async function parseSymbols(
  id: LanguageId,
  source: string,
): Promise<OutlineSymbol[]> {
  const mod = await loadRuntime();
  const language = await loadGrammar(id);
  if (mod === null || language === null) {
    return [];
  }

  try {
    const parser = new mod.Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);
    if (tree === null) {
      return [];
    }
    return collectSymbols(tree.rootNode, id);
  } catch {
    return [];
  }
}
