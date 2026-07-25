import { describe, expect, it } from "vitest";
import {
  clip,
  clipSentence,
  firstLine,
  nonEmptyLines,
  snippet,
  textOf,
  textParts,
} from "../src/lib/recall/content";

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

  it("filters image blocks (only text parts)", () => {
    const content = [
      { type: "text" as const, text: "visible" },
      {
        type: "image" as const,
        data: "base64...",
        mimeType: "image/png",
      },
    ];
    expect(textParts(content as any)).toEqual(["visible"]);
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

  it("truncates at max when no word boundary found", () => {
    const text = "abcdefghijklmnop"; // no spaces
    const result = clip(text, 5);
    expect(result).toBe("abcde"); // hard cut at index 5
  });

  it("uses default max of 200", () => {
    const short = "short text";
    expect(clip(short)).toBe(short);
  });
});

describe("clipSentence", () => {
  it("returns text unchanged when shorter than max", () => {
    expect(clipSentence("Short sentence.", 300)).toBe("Short sentence.");
  });

  it("clips at last sentence boundary within max", () => {
    const text = "First sentence. Second sentence. Third sentence still going.";
    const result = clipSentence(text, 40);
    expect(result).toContain("First sentence.");
    expect(result).not.toContain("Third");
    // Should end at or near the sentence boundary
    expect(result.endsWith(".")).toBe(true);
  });

  it("falls back to clip() when no sentence boundary in acceptable range", () => {
    const text =
      "this is a very long text with no punctuation at all anywhere in the string and it just keeps going";
    const result = clipSentence(text, 30);
    // No periods → falls through to clip()
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it("does not clip at mid-sentence abbreviations (context-dependent)", () => {
    // "Dr." would match but the function doesn't distinguish — it clips at any [.!?]
    // This test documents current behavior
    const text = "Hello Dr. Smith and welcome to the clinic.";
    const result = clipSentence(text, 15);
    // Clips at "Dr." since the function treats all dots as sentence boundaries
    expect(result).toContain("Dr.");
  });

  it("clips at exclamation mark when within threshold", () => {
    // "Hi there! Something went wrong. Continue." = 40+ chars, ! at index 8
    // max=16 → ! at index 8 is >= 16*0.5=8 ✓
    const text = "Hi there! Something went wrong. Continue.";
    const result = clipSentence(text, 16);
    expect(result).toBe("Hi there!");
  });

  it("clips at question mark when within threshold", () => {
    // "Why did this happen? Next sentence." → ? at index 19, max=30 → 20 >= 15 ✓
    const text = "Why did this happen? Next sentence continues on.";
    const result = clipSentence(text, 30);
    expect(result).toBe("Why did this happen?");
  });
});

describe("nonEmptyLines", () => {
  it("splits text into trimmed non-empty lines", () => {
    const text = "  hello  \n\n  world  \n  ";
    expect(nonEmptyLines(text)).toEqual(["hello", "world"]);
  });

  it("returns empty array for whitespace-only text", () => {
    expect(nonEmptyLines("  \n  \n  ")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(nonEmptyLines("")).toEqual([]);
  });

  it("handles single line", () => {
    expect(nonEmptyLines("single line")).toEqual(["single line"]);
  });
});

describe("snippet", () => {
  it("returns snippet around first match", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    const result = snippet(text, "fox");
    expect(result).toContain("fox");
    expect(result!.length).toBeGreaterThan("fox".length);
  });

  it("returns null when term not found", () => {
    const text = "hello world";
    expect(snippet(text, "missing")).toBeNull();
  });

  it("is case-insensitive", () => {
    const text = "Hello World";
    expect(snippet(text, "hello")).toContain("Hello World");
  });

  it("adds prefix ... when match is not near start", () => {
    const prefix = "x".repeat(100);
    const text = `${prefix} TARGET rest`;
    const result = snippet(text, "TARGET", 10);
    expect(result).toContain("...");
    expect(result).toContain("TARGET");
  });

  it("adds suffix ... when match is not near end", () => {
    const text = `start TARGET ${"x".repeat(100)}`;
    const result = snippet(text, "TARGET", 10);
    expect(result!.endsWith("...")).toBe(true);
  });

  it("does not add ellipsis when match is near both start and end", () => {
    const text = "TARGET here";
    const result = snippet(text, "TARGET", 100);
    expect(result).toBe("TARGET here");
    expect(result).not.toContain("...");
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
