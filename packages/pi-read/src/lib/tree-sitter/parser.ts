import type { LanguageId, OutlineSymbol } from "../../types.js";

/**
 * Placeholder — WASM tree-sitter lands in later phases:
 *   - Phase 1: grammar registry + lazy `web-tree-sitter` loader.
 *   - Phase 2: symbol extraction walk.
 *
 * Until then, returns [] so the read tool delegates to the built-in read.
 */
export async function parseSymbols(
  _id: LanguageId,
  _source: string,
): Promise<OutlineSymbol[]> {
  return [];
}
