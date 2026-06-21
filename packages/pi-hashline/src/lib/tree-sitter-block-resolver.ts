/**
 * Tree-sitter backed {@link BlockResolver} — resolves `replace block N:` anchors
 * to syntactic block line spans for supported languages.
 *
 * Language detection is driven by file extension. Core grammars (TypeScript,
 * Python, YAML) are hard dependencies loaded at import time; optional grammars
 * (Bash, JSON, TOML, CSS, HTML, Rust, Go) are loaded on demand via
 * {@link createRequire} + try/catch and cached per extension.
 */

import { createRequire } from "node:module";
import { extname } from "node:path";
import type Parser from "tree-sitter";
import type { Language } from "tree-sitter";

import type {
  BlockResolver,
  BlockResolverRequest,
  BlockSpan,
} from "./hashline/types.js";

// ─── Extension → grammar config ──────────────────────────────────────

interface GrammarConfig {
  /** npm package name passed to createRequire */
  pkg: string;
  /** Property name on the required module that holds the Language, or
   * `null` when the module itself *is* the Language. */
  prop: string | null;
}

const EXTENSION_CONFIG: Record<string, GrammarConfig> = {
  // ── Core (hard dependency) ──────────────────────────────────────
  ".ts": { pkg: "tree-sitter-typescript", prop: "typescript" },
  ".tsx": { pkg: "tree-sitter-typescript", prop: "tsx" },
  ".js": { pkg: "tree-sitter-javascript", prop: null },
  ".jsx": { pkg: "tree-sitter-javascript", prop: null },
  ".mjs": { pkg: "tree-sitter-javascript", prop: null },
  ".cjs": { pkg: "tree-sitter-javascript", prop: null },
  ".py": { pkg: "tree-sitter-python", prop: null },
  ".pyw": { pkg: "tree-sitter-python", prop: null },
  ".yaml": { pkg: "tree-sitter-yaml", prop: null },
  ".yml": { pkg: "tree-sitter-yaml", prop: null },

  // ── Optional (installed on demand) ──────────────────────────────
  ".sh": { pkg: "tree-sitter-bash", prop: null },
  ".bash": { pkg: "tree-sitter-bash", prop: null },
  ".json": { pkg: "tree-sitter-json", prop: null },
  ".toml": { pkg: "tree-sitter-toml", prop: null },
  ".css": { pkg: "tree-sitter-css", prop: null },
  ".html": { pkg: "tree-sitter-html", prop: null },
  ".htm": { pkg: "tree-sitter-html", prop: null },
  ".rs": { pkg: "tree-sitter-rust", prop: null },
  ".go": { pkg: "tree-sitter-go", prop: null },
};

// ─── Language cache ──────────────────────────────────────────────────

const _require = createRequire(import.meta.url);

let _ParserClass: typeof Parser | null | undefined;

/** Lazily load the tree-sitter Parser class. Returns null if tree-sitter is not installed. */
function getParserClass(): typeof Parser | null {
  if (_ParserClass === undefined) {
    try {
      const mod = _require("tree-sitter") as Record<string, unknown>;
      _ParserClass = (mod.default ?? mod) as typeof Parser;
    } catch {
      _ParserClass = null;
    }
  }
  return _ParserClass;
}
const langCache = new Map<string, Language | null>();

/**
 * Load (or retrieve from cache) the tree-sitter Language for a file
 * extension. Returns `null` when the extension is unknown or the
 * grammar package failed to load.
 */
function getLanguage(ext: string): Language | null {
  const cfg = EXTENSION_CONFIG[ext];
  if (!cfg) {
    return null;
  }

  const cached = langCache.get(ext);
  if (cached !== undefined) {
    return cached;
  }

  let lang: Language | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: Record<string, unknown> = _require(cfg.pkg) as Record<
      string,
      unknown
    >;
    if (cfg.prop !== null) {
      // Specific property (e.g. tree-sitter-typescript → .typescript / .tsx)
      lang = (mod[cfg.prop] as Language) ?? null;
    } else {
      // Module itself is the Language (common for most grammars)
      lang = mod as unknown as Language;
    }
  } catch {
    lang = null;
  }

  // Validate — setLanguage throws on invalid objects
  if (lang !== null) {
    const ParserCtor = getParserClass();
    if (ParserCtor === null) {
      return null;
    }
    try {
      const probe = new ParserCtor();
      probe.setLanguage(lang);
    } catch {
      lang = null;
    }
  }

  langCache.set(ext, lang);
  return lang;
}

// ─── Resolver implementation ─────────────────────────────────────────

/**
 * Core algorithm: find the syntactic block that begins on `line`.
 *
 * 1. Validate input (line > 0, non-empty text).
 * 2. Resolve tree-sitter Language from file extension.
 * 3. Find the byte column of the first non-whitespace char on the target
 *    line (0-indexed row = line - 1).
 * 4. If the line is blank / whitespace-only → return `null`.
 * 5. Parse source with tree-sitter.
 * 6. Call `namedDescendantForPosition(row, col)` — the leaf at that point.
 * 7. If leaf's `startPosition.row !== row` → `null` (point landed on
 *    continuation line or closing delimiter of a block that opened earlier).
 * 8. Climb to outermost named ancestor that still starts on `row`,
 *    excluding the root node.
 * 9. If the resolved node or any descendant has an error → `null`.
 * 10. Return `{ start: node.startPosition.row + 1, end: node.endPosition.row + 1 }`.
 */
function blockRangeAt(
  code: string,
  line: number,
  language: Language,
): BlockSpan | null {
  // 1. Validate input
  if (line < 1 || code.length === 0) {
    return null;
  }

  // 3. Find the first non-whitespace column on the target line
  const lines = code.split("\n");
  const row = line - 1;
  if (row >= lines.length) {
    return null;
  }

  const targetLine = lines[row];
  if (targetLine === undefined) {
    return null;
  }

  // 4. Blank / whitespace-only line → null
  const col = targetLine.search(/\S/);
  if (col === -1) {
    return null;
  }

  // 5. Parse
  const ParserCtor = getParserClass();
  if (ParserCtor === null) {
    return null;
  }
  const parser = new ParserCtor();
  parser.setLanguage(language);
  const tree = parser.parse(code);

  // 6. Find named leaf at (row, col)
  const leaf = tree.rootNode.namedDescendantForPosition({ row, column: col });
  if (!leaf) {
    return null;
  }

  // 7. Leaf must start on the target row
  if (leaf.startPosition.row !== row) {
    return null;
  }

  // 8. Climb to outermost named ancestor that starts on `row`
  let node = leaf;
  while (
    node.parent &&
    node.parent.type !== tree.rootNode.type &&
    node.parent.startPosition.row === row
  ) {
    node = node.parent;
  }

  // 9. Error check — node.hasError propagates to ancestors in tree-sitter 0.22.x
  if (node.hasError) {
    return null;
  }

  // 10. Return 1-indexed span with trailing-newline correction
  // (ported from oh-my-pi's node_content_end_line: when endPosition lands
  // at column 0 of the next row, the last content byte was the newline on
  // the previous row.)
  const endPos = node.endPosition;
  const endRow =
    endPos.column === 0 && endPos.row > 0
      ? endPos.row // last content was on previous row
      : endPos.row + 1;
  return {
    start: node.startPosition.row + 1,
    end: endRow,
  };
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Create a {@link BlockResolver} backed by tree-sitter.
 *
 * Language grammars are loaded lazily from the npm packages listed in
 * {@link EXTENSION_CONFIG} and cached per file extension. Unknown
 * extensions and missing optional grammar packages silently return
 * `null`.
 */
export function createTreeSitterBlockResolver(): BlockResolver {
  return (request: BlockResolverRequest): BlockSpan | null => {
    const ext = extname(request.path).toLowerCase();
    const language = getLanguage(ext);
    if (!language) {
      return null;
    }
    return blockRangeAt(request.text, request.line, language);
  };
}
