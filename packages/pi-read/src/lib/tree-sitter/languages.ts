import { extname } from "node:path";
import type { LanguageId } from "../../types.js";

export interface GrammarSpec {
  id: LanguageId;
  extensions: string[];
}

export const GRAMMARS: GrammarSpec[] = [
  { id: "typescript", extensions: [".ts", ".mts", ".cts"] },
  { id: "tsx", extensions: [".tsx"] },
  { id: "javascript", extensions: [".js", ".mjs", ".cjs", ".jsx"] },
  { id: "csharp", extensions: [".cs"] },
  { id: "python", extensions: [".py"] },
  { id: "rust", extensions: [".rs"] },
];

const EXTENSION_MAP = new Map<string, LanguageId>(
  GRAMMARS.flatMap((g) => g.extensions.map((ext) => [ext, g.id] as const)),
);

/** Resolve a file extension to a supported language, or null. */
export function detectLanguage(path: string): LanguageId | null {
  return EXTENSION_MAP.get(extname(path).toLowerCase()) ?? null;
}
