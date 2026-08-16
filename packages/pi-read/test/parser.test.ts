import { describe, expect, it } from "vitest";
import { parseSymbols } from "../src/lib/tree-sitter/parser.js";

describe("parseSymbols", () => {
  it("extracts nested TypeScript symbols with exact line ranges", async () => {
    const source = [
      "class App {",
      "  constructor() {}",
      "  handleRequest() {}",
      "}",
      "function main() {",
      "  return 1;",
      "}",
    ].join("\n");

    const symbols = await parseSymbols("typescript", source);
    expect(symbols).toHaveLength(2);

    const [app, main] = symbols;
    expect(app).toMatchObject({
      name: "App",
      type: "class",
      startLine: 1,
      endLine: 4,
    });
    expect(app!.children).toHaveLength(2);
    expect(app!.children[0]).toMatchObject({
      name: "constructor",
      type: "method",
      startLine: 2,
      endLine: 2,
    });
    expect(app!.children[1]).toMatchObject({
      name: "handleRequest",
      type: "method",
      startLine: 3,
      endLine: 3,
    });
    expect(main).toMatchObject({
      name: "main",
      type: "function",
      startLine: 5,
      endLine: 7,
    });
  });

  it("extracts a Python class and its nested function", async () => {
    const source = [
      "class Foo:",
      "    def bar(self):",
      "        return 1",
    ].join("\n");
    const symbols = await parseSymbols("python", source);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      name: "Foo",
      type: "class",
      startLine: 1,
      endLine: 3,
    });
    expect(symbols[0]!.children).toHaveLength(1);
    expect(symbols[0]!.children[0]).toMatchObject({
      name: "bar",
      type: "function",
      startLine: 2,
      endLine: 3,
    });
  });

  it("extracts Rust function and struct", async () => {
    const source = ["fn main() {}", "struct Point {", "    x: i32,", "}"].join(
      "\n",
    );
    const symbols = await parseSymbols("rust", source);

    expect(symbols.map((s) => s.name)).toEqual(["main", "Point"]);
    expect(symbols[0]).toMatchObject({
      type: "function",
      startLine: 1,
      endLine: 1,
    });
    expect(symbols[1]).toMatchObject({
      type: "struct",
      startLine: 2,
      endLine: 4,
    });
  });

  it("extracts a C# class and its method", async () => {
    const source = ["class Foo {", "    void Bar() {}", "}"].join("\n");
    const symbols = await parseSymbols("csharp", source);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      name: "Foo",
      type: "class",
      startLine: 1,
      endLine: 3,
    });
    expect(symbols[0]!.children[0]).toMatchObject({
      name: "Bar",
      type: "method",
      startLine: 2,
      endLine: 2,
    });
  });

  it("extracts JS arrow-function consts", async () => {
    const source = [
      "const add = (a, b) => a + b;",
      "function helper() {}",
    ].join("\n");
    const symbols = await parseSymbols("javascript", source);

    expect(symbols.map((s) => s.name)).toEqual(["add", "helper"]);
    expect(symbols[0]).toMatchObject({
      type: "const",
      startLine: 1,
      endLine: 1,
    });
  });

  it("emits every arrow declarator with its let/const kind", async () => {
    const source = [
      "let run = () => 1;",
      "const x = 2, y = () => 3;",
      "const z = 4;",
    ].join("\n");
    const symbols = await parseSymbols("typescript", source);

    expect(symbols).toHaveLength(2);
    expect(symbols[0]).toMatchObject({
      name: "run",
      type: "let",
      startLine: 1,
      endLine: 1,
    });
    expect(symbols[1]).toMatchObject({
      name: "y",
      type: "const",
      startLine: 2,
      endLine: 2,
    });
  });

  it("collects nested symbols inside arrow-function declarators", async () => {
    const source = [
      "const factory = () => {",
      "  class Inner {}",
      "  return Inner;",
      "};",
    ].join("\n");
    const symbols = await parseSymbols("typescript", source);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({
      name: "factory",
      type: "const",
      startLine: 1,
      endLine: 4,
    });
    expect(symbols[0]!.children).toHaveLength(1);
    expect(symbols[0]!.children[0]).toMatchObject({
      name: "Inner",
      type: "class",
      startLine: 2,
      endLine: 2,
    });
  });

  it("returns [] for empty, comment-only, and invalid input", async () => {
    expect(await parseSymbols("typescript", "")).toEqual([]);
    expect(await parseSymbols("typescript", "// just a comment\n")).toEqual([]);
    expect(await parseSymbols("typescript", "class {")).toEqual([]);
  });
});
