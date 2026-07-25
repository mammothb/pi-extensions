import { describe, expect, it } from "vitest";
import {
  extractTextContent,
  firstTextBlock,
} from "../src/extract-text-content.js";

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function imageBlock() {
  return { type: "image" as const, data: "base64...", mimeType: "image/png" };
}

function makeResult(content: unknown[]) {
  return { content, details: null };
}

describe("extractTextContent", () => {
  it("joins multiple text blocks with newlines", () => {
    const result = makeResult([textBlock("hello"), textBlock("world")]);
    expect(extractTextContent(result as any)).toBe("hello\nworld");
  });

  it("returns single text block as-is", () => {
    const result = makeResult([textBlock("hello")]);
    expect(extractTextContent(result as any)).toBe("hello");
  });

  it("filters out image blocks", () => {
    const result = makeResult([
      textBlock("before"),
      imageBlock(),
      textBlock("after"),
    ]);
    expect(extractTextContent(result as any)).toBe("before\nafter");
  });

  it("returns empty string for all-image content", () => {
    const result = makeResult([imageBlock(), imageBlock()]);
    expect(extractTextContent(result as any)).toBe("");
  });

  it("returns empty string for empty content array", () => {
    const result = makeResult([]);
    expect(extractTextContent(result as any)).toBe("");
  });
});

describe("firstTextBlock", () => {
  it("returns first text block content", () => {
    const result = makeResult([textBlock("first"), textBlock("second")]);
    expect(firstTextBlock(result as any)).toBe("first");
  });

  it("returns empty string when first block is an image", () => {
    const result = makeResult([imageBlock(), textBlock("hidden")]);
    expect(firstTextBlock(result as any)).toBe("");
  });

  it("returns empty string for empty content", () => {
    const result = makeResult([]);
    expect(firstTextBlock(result as any)).toBe("");
  });
});
