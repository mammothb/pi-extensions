import { describe, expect, it } from "vitest";

import {
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "../src/normalize";

describe("stripBom", () => {
  it("strips UTF-8 BOM", () => {
    const result = stripBom("\uFEFFhello\n");
    expect(result.bom).toBe("\uFEFF");
    expect(result.text).toBe("hello\n");
  });

  it("returns empty bom for text without BOM", () => {
    const result = stripBom("hello\n");
    expect(result.bom).toBe("");
    expect(result.text).toBe("hello\n");
  });

  it("returns empty bom for empty string", () => {
    const result = stripBom("");
    expect(result.bom).toBe("");
    expect(result.text).toBe("");
  });

  it("does not strip BOM appearing mid-text", () => {
    const result = stripBom("hello\uFEFFworld");
    expect(result.bom).toBe("");
    expect(result.text).toBe("hello\uFEFFworld");
  });
});

describe("detectLineEnding", () => {
  it("detects LF", () => {
    expect(detectLineEnding("hello\nworld\n")).toBe("\n");
  });

  it("detects CRLF", () => {
    expect(detectLineEnding("hello\r\nworld\r\n")).toBe("\r\n");
  });

  it("defaults to LF for single-line text", () => {
    expect(detectLineEnding("hello")).toBe("\n");
  });

  it("detects CRLF when CRLF appears before LF", () => {
    expect(detectLineEnding("a\r\nb\nc")).toBe("\r\n");
  });

  it("detects LF when LF appears before CRLF", () => {
    expect(detectLineEnding("a\nb\r\nc")).toBe("\n");
  });
});

describe("normalizeToLF", () => {
  it("converts CRLF to LF", () => {
    expect(normalizeToLF("hello\r\nworld")).toBe("hello\nworld");
  });

  it("converts standalone CR to LF", () => {
    expect(normalizeToLF("hello\rworld")).toBe("hello\nworld");
  });

  it("leaves LF unchanged", () => {
    expect(normalizeToLF("hello\nworld")).toBe("hello\nworld");
  });
});

describe("restoreLineEndings", () => {
  it("restores CRLF", () => {
    expect(restoreLineEndings("hello\nworld", "\r\n")).toBe("hello\r\nworld");
  });

  it("leaves LF unchanged", () => {
    expect(restoreLineEndings("hello\nworld", "\n")).toBe("hello\nworld");
  });
});
