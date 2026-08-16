/** Languages with an available tree-sitter grammar. */
export type LanguageId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "csharp"
  | "python"
  | "rust";

/** A structural symbol extracted from an AST (class, function, method, …). */
export interface OutlineSymbol {
  name: string;
  type: string;
  /** 1-indexed, inclusive. */
  startLine: number;
  endLine: number;
  children: OutlineSymbol[];
}

export interface ReadConfig {
  enabled: boolean;
  /** Outline when the file exceeds this many lines. */
  thresholdLines: number;
  /** …or this many bytes (outline when either limit is exceeded). */
  thresholdBytes: number;
  /** Maximum nesting depth shown in the outline. */
  maxDepth: number;
  /** Per-language enable flag. Disabled languages delegate to the built-in read. */
  languages: Record<LanguageId, boolean>;
}
