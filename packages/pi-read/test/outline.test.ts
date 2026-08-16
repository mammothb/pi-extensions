import { describe, expect, it } from "vitest";
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
