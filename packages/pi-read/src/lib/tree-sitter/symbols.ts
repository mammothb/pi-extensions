import type { Node } from "web-tree-sitter";
import type { LanguageId, OutlineSymbol } from "../../types.js";

export type SymbolKind =
  | {
      nodeType: string;
      /** Friendly label shown in the outline (e.g. "class", "function"). */
      label: string;
      /** Field holding the identifier (e.g. "name", "type"). */
      nameField: string;
    }
  | {
      nodeType: string;
      /** Emit one symbol per arrow-function declarator; label from `const`/`let`. */
      arrowDeclarators: true;
    };

const TS_KINDS: SymbolKind[] = [
  { nodeType: "class_declaration", label: "class", nameField: "name" },
  { nodeType: "function_declaration", label: "function", nameField: "name" },
  { nodeType: "method_definition", label: "method", nameField: "name" },
  { nodeType: "interface_declaration", label: "interface", nameField: "name" },
  { nodeType: "enum_declaration", label: "enum", nameField: "name" },
  { nodeType: "type_alias_declaration", label: "type", nameField: "name" },
  { nodeType: "lexical_declaration", arrowDeclarators: true },
];

export const SYMBOL_KINDS: Record<LanguageId, SymbolKind[]> = {
  typescript: TS_KINDS,
  tsx: TS_KINDS,
  javascript: TS_KINDS,
  csharp: [
    { nodeType: "class_declaration", label: "class", nameField: "name" },
    {
      nodeType: "interface_declaration",
      label: "interface",
      nameField: "name",
    },
    { nodeType: "method_declaration", label: "method", nameField: "name" },
    {
      nodeType: "constructor_declaration",
      label: "constructor",
      nameField: "name",
    },
    { nodeType: "struct_declaration", label: "struct", nameField: "name" },
    { nodeType: "enum_declaration", label: "enum", nameField: "name" },
    {
      nodeType: "namespace_declaration",
      label: "namespace",
      nameField: "name",
    },
  ],
  python: [
    { nodeType: "class_definition", label: "class", nameField: "name" },
    { nodeType: "function_definition", label: "function", nameField: "name" },
  ],
  rust: [
    { nodeType: "function_item", label: "function", nameField: "name" },
    { nodeType: "struct_item", label: "struct", nameField: "name" },
    { nodeType: "enum_item", label: "enum", nameField: "name" },
    { nodeType: "trait_item", label: "trait", nameField: "name" },
    { nodeType: "impl_item", label: "impl", nameField: "type" },
  ],
};

/** Collect structural symbols from a parsed tree, nesting at symbol boundaries. */
export function collectSymbols(root: Node, id: LanguageId): OutlineSymbol[] {
  // Precompute a nodeType → kind map once per language; `walk` does a lookup
  // per node, so a hash map beats a linear `find` over the small kind list.
  const kindByType = new Map(
    (SYMBOL_KINDS[id] ?? []).map((k) => [k.nodeType, k]),
  );
  const out: OutlineSymbol[] = [];
  walk(root, kindByType, out);
  return out;
}

function walk(
  node: Node,
  kindByType: Map<string, SymbolKind>,
  out: OutlineSymbol[],
): void {
  const kind = kindByType.get(node.type);
  if (kind !== undefined) {
    if ("arrowDeclarators" in kind) {
      emitArrowDeclarators(node, kindByType, out);
      return;
    }
    const name = resolveName(node, kind);
    if (name !== null) {
      const symbol: OutlineSymbol = {
        name,
        type: kind.label,
        startLine: node.startPosition.row + 1,
        endLine: endLine(node),
        children: [],
      };
      for (const child of node.children) {
        walk(child, kindByType, symbol.children);
      }
      out.push(symbol);
      return;
    }
  }
  for (const child of node.children) {
    walk(child, kindByType, out);
  }
}

function resolveName(node: Node, kind: { nameField: string }): string | null {
  const nameNode = node.childForFieldName(kind.nameField);
  if (nameNode === null || nameNode.isMissing || nameNode.text.trim() === "") {
    return null;
  }
  return nameNode.text;
}

/** Emit one symbol per arrow-function declarator (label from `const`/`let`). */
function emitArrowDeclarators(
  node: Node,
  kindByType: Map<string, SymbolKind>,
  out: OutlineSymbol[],
): void {
  const label = node.child(0)?.text ?? "const";
  for (const declarator of node.namedChildren) {
    if (declarator.type !== "variable_declarator") {
      continue;
    }
    if (declarator.childForFieldName("value")?.type !== "arrow_function") {
      continue;
    }
    const nameNode = declarator.childForFieldName("name");
    if (
      nameNode === null ||
      nameNode.isMissing ||
      nameNode.text.trim() === ""
    ) {
      continue;
    }
    const symbol: OutlineSymbol = {
      name: nameNode.text,
      type: label,
      startLine: declarator.startPosition.row + 1,
      endLine: endLine(declarator),
      children: [],
    };
    for (const child of declarator.children) {
      walk(child, kindByType, symbol.children);
    }
    out.push(symbol);
  }
}

/**
 * 1-indexed, inclusive last line of a node.
 *
 * `endPosition` is exclusive (points one past the last byte), so a mid-line
 * end (`column > 0`) lands on `row`, while an end at a line boundary
 * (`column === 0`) has already rolled onto the next row — the node really
 * ended on `row - 1`.
 */
function endLine(node: Node): number {
  const { row, column } = node.endPosition;
  return column > 0 ? row + 1 : row;
}
