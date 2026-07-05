import { describe, expect, it } from "vitest";
import { clip, firstLine, textOf, textParts } from "../src/core/content";

describe("textParts", () => {
  it("returns [] for undefined content", () => {
    expect(textParts(undefined as any)).toEqual([]);
  });

  it("returns [] for null content", () => {
    expect(textParts(null as any)).toEqual([]);
  });

  it("wraps string content", () => {
    expect(textParts("hello")).toEqual(["hello"]);
  });

  it("extracts text parts from array content", () => {
    const content = [
      { type: "text" as const, text: "first" },
      { type: "toolCall" as const, name: "x", id: "1", arguments: {} },
      { type: "text" as const, text: "second" },
    ];
    expect(textParts(content)).toEqual(["first", "second"]);
  });
});

describe("textOf", () => {
  it("returns empty string for undefined content", () => {
    expect(textOf(undefined as any)).toBe("");
  });

  it("joins text parts", () => {
    const content = [
      { type: "text" as const, text: "line 1" },
      { type: "text" as const, text: "line 2" },
    ];
    expect(textOf(content)).toBe("line 1\nline 2");
  });

  it("returns string content as-is", () => {
    expect(textOf("plain text")).toBe("plain text");
  });
});

describe("clip", () => {
  it("returns short text unchanged", () => {
    expect(clip("short", 300)).toBe("short");
  });

  it("truncates at word boundary", () => {
    const text = "hello world this is a long text";
    const result = clip(text, 12);
    expect(result.length).toBeLessThanOrEqual(12);
    expect(result).not.toContain("long");
  });

  it("handles text shorter than limit", () => {
    expect(clip("hi", 200)).toBe("hi");
  });
});

describe("firstLine", () => {
  it("returns first line", () => {
    expect(firstLine("line1\nline2\nline3")).toBe("line1");
  });

  it("handles single line", () => {
    expect(firstLine("only line")).toBe("only line");
  });

  it("truncates long first line", () => {
    const long = "x".repeat(300);
    const result = firstLine(`${long}\nmore`, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });
});
