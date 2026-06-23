import { describe, expect, it } from "vitest";

import {
  computeFileHash,
  formatHashlineHeader,
  HL_FILE_HASH_LENGTH,
} from "../src/lib/hashline/format.js";

describe("computeFileHash", () => {
  it("produces a 6-character uppercase hex string", () => {
    const hash = computeFileHash("hello\n");
    expect(hash).toHaveLength(HL_FILE_HASH_LENGTH);
    expect(hash).toMatch(/^[0-9A-F]{6}$/);
  });

  it("is stable for identical content", () => {
    expect(computeFileHash("hello\n")).toBe(computeFileHash("hello\n"));
  });

  it("produces different hashes for different content", () => {
    expect(computeFileHash("hello\n")).not.toBe(computeFileHash("world\n"));
  });

  it("normalizes trailing whitespace per line", () => {
    // Trailing spaces and tabs are trimmed before hashing.
    expect(computeFileHash("hello  \n")).toBe(computeFileHash("hello\n"));
    expect(computeFileHash("hello\t\n")).toBe(computeFileHash("hello\n"));
  });

  it("normalizes trailing \\r (CRLF)", () => {
    expect(computeFileHash("hello\r\n")).toBe(computeFileHash("hello\n"));
  });

  it("produces different hashes for different multi-line content", () => {
    const a = "line1\nline2\n";
    const b = "line1\nline2_changed\n";
    expect(computeFileHash(a)).not.toBe(computeFileHash(b));
  });

  it("is stable across repeated calls", () => {
    const text = "const x = 42;\nconst y = 100;\n";
    const h1 = computeFileHash(text);
    const h2 = computeFileHash(text);
    const h3 = computeFileHash(text);
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });
});

describe("formatHashlineHeader", () => {
  it("formats a hashline header", () => {
    expect(formatHashlineHeader("src/foo.ts", "A1B200")).toBe(
      "¶src/foo.ts#A1B200",
    );
  });
});
