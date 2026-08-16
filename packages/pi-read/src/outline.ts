import type { OutlineSymbol } from "./types.js";

export interface RenderOptions {
  maxDepth: number;
  totalLines: number;
  fileLabel: string;
  languageLabel?: string;
}

/**
 * Render a token-efficient structural outline in the Sweep blog format:
 * `(N children) [start:end]`.
 */
export function renderOutline(
  symbols: OutlineSymbol[],
  opts: RenderOptions,
): string {
  const lines: string[] = [];
  const lang = opts.languageLabel ? ` (${opts.languageLabel})` : "";
  lines.push(`${opts.fileLabel}${lang} — ${opts.totalLines} lines`);

  if (symbols.length === 0) {
    lines.push("  (no symbols)");
  } else {
    renderSymbolList(symbols, 1, opts.maxDepth, "", lines);
  }

  lines.push("");
  lines.push("Use read with offset/limit to view a specific section.");
  return lines.join("\n");
}

function renderSymbolList(
  symbols: OutlineSymbol[],
  depth: number,
  maxDepth: number,
  prefix: string,
  lines: string[],
): void {
  symbols.forEach((symbol, index) => {
    const isLast = index === symbols.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? `${prefix}    ` : `${prefix}│   `;
    const children = symbol.children;
    const childInfo =
      children.length > 0 ? ` (${children.length} children)` : "";

    lines.push(
      `${prefix}${connector}${symbol.type} ${symbol.name}${childInfo} [${symbol.startLine}:${symbol.endLine}]`,
    );

    if (children.length > 0 && depth < maxDepth) {
      renderSymbolList(children, depth + 1, maxDepth, childPrefix, lines);
    } else if (children.length > 0) {
      lines.push(`${childPrefix}(${children.length} nested items)`);
    }
  });
}
