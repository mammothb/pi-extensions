import { extname } from "node:path";
import type { LanguageId } from "../../types.js";

export interface GrammarSpec {
  id: LanguageId;
  package: string;
  wasmFile: string;
  extensions: string[];
}

export const GRAMMARS: GrammarSpec[] = [
  {
    id: "typescript",
    package: "tree-sitter-typescript",
    wasmFile: "tree-sitter-typescript.wasm",
    extensions: [".ts", ".mts", ".cts"],
  },
  {
    id: "tsx",
    package: "tree-sitter-typescript",
    wasmFile: "tree-sitter-tsx.wasm",
    extensions: [".tsx"],
  },
  {
    id: "javascript",
    package: "tree-sitter-javascript",
    wasmFile: "tree-sitter-javascript.wasm",
    extensions: [".js", ".mjs", ".cjs", ".jsx"],
  },
  {
    id: "csharp",
    package: "tree-sitter-c-sharp",
    wasmFile: "tree-sitter-c_sharp.wasm",
    extensions: [".cs"],
  },
  {
    id: "python",
    package: "tree-sitter-python",
    wasmFile: "tree-sitter-python.wasm",
    extensions: [".py"],
  },
  {
    id: "rust",
    package: "tree-sitter-rust",
    wasmFile: "tree-sitter-rust.wasm",
    extensions: [".rs"],
  },
];

const EXTENSION_MAP = new Map<string, LanguageId>(
  GRAMMARS.flatMap((g) => g.extensions.map((ext) => [ext, g.id] as const)),
);

/** Resolve a file extension to a supported language, or null. */
export function detectLanguage(path: string): LanguageId | null {
  return EXTENSION_MAP.get(extname(path).toLowerCase()) ?? null;
}
