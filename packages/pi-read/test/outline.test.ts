import { describe, expect, it } from "vitest";
import { parseSymbols } from "../src/lib/tree-sitter/parser.js";
import { renderOutline } from "../src/outline.js";
import type { OutlineSymbol } from "../src/types.js";

const SYMBOLS: OutlineSymbol[] = [
  {
    name: "App",
    type: "class",
    startLine: 1,
    endLine: 90,
    children: [
      {
        name: "handleRequest",
        type: "method",
        startLine: 15,
        endLine: 50,
        children: [],
      },
    ],
  },
  { name: "main", type: "function", startLine: 92, endLine: 100, children: [] },
];

describe("renderOutline", () => {
  it("renders a header and symbol tree", () => {
    const outline = renderOutline(SYMBOLS, {
      maxDepth: 10,
      totalLines: 100,
      fileLabel: "server.ts",
      languageLabel: "typescript",
    });

    expect(outline).toContain("server.ts (typescript) — 100 lines");
    expect(outline).toContain("class App (1 children) [1:90]");
    expect(outline).toContain("method handleRequest [15:50]");
    expect(outline).toContain("function main [92:100]");
  });

  it("collapses children past maxDepth", () => {
    const outline = renderOutline(SYMBOLS, {
      maxDepth: 1,
      totalLines: 100,
      fileLabel: "server.ts",
    });

    expect(outline).toContain("class App (1 children) [1:90]");
    expect(outline).toContain("(1 nested items)");
    expect(outline).not.toContain("handleRequest");
  });

  it("reports empty symbol sets", () => {
    const outline = renderOutline([], {
      maxDepth: 10,
      totalLines: 10,
      fileLabel: "empty.ts",
    });

    expect(outline).toContain("(no symbols)");
  });
});

describe("renderOutline with real parseSymbols output", () => {
  const source = [
    "class App {",
    "  constructor(private config: AppConfig) {}",
    "  async handleRequest(req: Request) {",
    "    return req;",
    "  }",
    "  private helper() {}",
    "}",
    "function main() {",
    "  const app = new App();",
    "}",
    "interface Config {}",
  ].join("\n");

  it("renders a navigable outline with line ranges and nesting", async () => {
    const symbols = await parseSymbols("typescript", source);
    const outline = renderOutline(symbols, {
      maxDepth: 10,
      totalLines: 11,
      fileLabel: "server.ts",
      languageLabel: "typescript",
    });

    expect(outline).toContain("server.ts (typescript) — 11 lines");
    expect(outline).toContain("class App (3 children) [1:7]");
    expect(outline).toContain("method constructor [2:2]");
    expect(outline).toContain("method handleRequest [3:5]");
    expect(outline).toContain("method helper [6:6]");
    expect(outline).toContain("function main [8:10]");
    expect(outline).toContain("interface Config [11:11]");
    expect(outline).toContain(
      "Use read with offset/limit to view a specific section.",
    );
  });

  it("collapses nested symbols past maxDepth", async () => {
    const symbols = await parseSymbols("typescript", source);
    const outline = renderOutline(symbols, {
      maxDepth: 1,
      totalLines: 11,
      fileLabel: "server.ts",
    });

    expect(outline).toContain("class App (3 children) [1:7]");
    expect(outline).toContain("(3 nested items)");
    expect(outline).not.toContain("handleRequest");
  });
});
