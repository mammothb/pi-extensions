import type { Node } from "web-tree-sitter";
import type { LanguageId, OutlineSymbol } from "../../types.js";

export interface SymbolKind {
  nodeType: string;
  /** Friendly label shown in the outline (e.g. "class", "function"). */
  label: string;
  /** Field holding the identifier (e.g. "name", "type"). */
  nameField?: string;
  /** Resolve the name from the first named child's `name` field instead. */
  fromDeclarator?: boolean;
  /** With `fromDeclarator`: only emit when the declarator's `value` is this type. */
  valueNodeType?: string;
}

const TS_KINDS: SymbolKind[] = [
  { nodeType: "class_declaration", label: "class", nameField: "name" },
  { nodeType: "function_declaration", label: "function", nameField: "name" },
  { nodeType: "method_definition", label: "method", nameField: "name" },
  { nodeType: "interface_declaration", label: "interface", nameField: "name" },
  { nodeType: "enum_declaration", label: "enum", nameField: "name" },
  { nodeType: "type_alias_declaration", label: "type", nameField: "name" },
  {
    nodeType: "lexical_declaration",
    label: "const",
    fromDeclarator: true,
    valueNodeType: "arrow_function",
  },
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
  const kinds = SYMBOL_KINDS[id] ?? [];
  const out: OutlineSymbol[] = [];
  walk(root, kinds, out);
  return out;
}

function walk(node: Node, kinds: SymbolKind[], out: OutlineSymbol[]): void {
  const kind = kinds.find((k) => k.nodeType === node.type);
  if (kind !== undefined) {
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
        walk(child, kinds, symbol.children);
      }
      out.push(symbol);
      return;
    }
  }
  for (const child of node.children) {
    walk(child, kinds, out);
  }
}

function resolveName(node: Node, kind: SymbolKind): string | null {
  let nameNode: Node | null;

  if (kind.fromDeclarator) {
    const declarator = node.namedChild(0);
    if (kind.valueNodeType !== undefined) {
      const value = declarator?.childForFieldName("value");
      if (value?.type !== kind.valueNodeType) {
        return null;
      }
    }
    nameNode = declarator?.childForFieldName("name") ?? null;
  } else if (kind.nameField !== undefined) {
    nameNode = node.childForFieldName(kind.nameField);
  } else {
    return null;
  }

  if (nameNode === null || nameNode.isMissing || nameNode.text.trim() === "") {
    return null;
  }
  return nameNode.text;
}

/** 1-indexed, inclusive last line of a node (endPosition is exclusive). */
function endLine(node: Node): number {
  const { row, column } = node.endPosition;
  return column > 0 ? row + 1 : row;
}
