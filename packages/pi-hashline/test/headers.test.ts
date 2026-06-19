import { describe, expect, it } from "vitest";

import { parseHashlineHeaders } from "../src/edit.js";

describe("parseHashlineHeaders", () => {
  it("extracts a single file path from a hashline header", () => {
    const input = "\u00b6src/foo.ts#A3F200\nreplace 10..12:\n+content";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });

  it("extracts multiple file paths from multiple headers", () => {
    const input =
      "\u00b6src/a.ts#1A2B00\nreplace 1..2:\n+foo\n\n\u00b6src/b.ts#3C4D00\ndelete 5";
    expect(parseHashlineHeaders(input)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("deduplicates repeated paths", () => {
    const input =
      "\u00b6src/a.ts#1A2B00\nreplace 1..2:\n+foo\n\n\u00b6src/a.ts#9F3E00\ndelete 3";
    expect(parseHashlineHeaders(input)).toEqual(["src/a.ts"]);
  });

  it("strips quotes around quoted paths (defensive)", () => {
    const input = '\u00b6"path with spaces/file.ts"#A3F200\nreplace 1..1:\n+x';
    expect(parseHashlineHeaders(input)).toEqual(["path with spaces/file.ts"]);
  });

  it("strips single quotes around quoted paths (defensive)", () => {
    const input = "\u00b6'path/file.ts'#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["path/file.ts"]);
  });

  it("handles stray \u00b6\u00b6 echo (model copies the sigil)", () => {
    const input = "\u00b6\u00b6src/foo.ts#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });

  it("handles many echoed \u00b6 sigils", () => {
    const input = "\u00b6\u00b6\u00b6src/foo.ts#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });

  it("handles header without hash tag", () => {
    const input = "\u00b6src/foo.ts\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });

  it("handles header with lower-case hash tag", () => {
    const input = "\u00b6src/foo.ts#a3f200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });

  it("returns empty array for input with no headers", () => {
    expect(parseHashlineHeaders("replace 1..2:\n+content")).toEqual([]);
    expect(parseHashlineHeaders("plain text\nmore text")).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(parseHashlineHeaders("")).toEqual([]);
    expect(parseHashlineHeaders("   ")).toEqual([]);
    expect(parseHashlineHeaders("\n\n")).toEqual([]);
  });

  it("handles BOM prefix", () => {
    const input = "\uFEFF\u00b6src/foo.ts#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });

  it("handles Windows line endings (\\r\\n)", () => {
    const input =
      "\u00b6src/a.ts#1A2B00\r\nreplace 1..1:\r\n+x\r\n\r\n\u00b6src/b.ts#3C4D00\r\ndelete 5";
    expect(parseHashlineHeaders(input)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("skips empty paths after stripping hash", () => {
    // Header with hash but only whitespace/empty before it.
    const input = "\u00b6#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual([]);
  });

  it("preserves path with internal hash character", () => {
    // Path like 'src/#foo/test.ts' — hash is at very end after last #
    const input = "\u00b6src/#foo/test.ts#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/#foo/test.ts"]);
  });

  it("handles leading whitespace before \u00b6", () => {
    const input = "  \u00b6src/foo.ts#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });

  it("handles header at start of line but not at start of input", () => {
    const input = "some text\n\u00b6src/foo.ts#A3F200\nreplace 1..1:\n+x";
    expect(parseHashlineHeaders(input)).toEqual(["src/foo.ts"]);
  });
});
