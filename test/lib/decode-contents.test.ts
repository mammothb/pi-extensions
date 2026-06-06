import { describe, expect, it } from "vitest";
import { decodeGitHubContent } from "../../src/lib/decode-contents.js";

describe("decodeGitHubContent", () => {
  it("decodes a valid Contents API response", () => {
    const input = "SGVsbG8gV29ybGQ="; // "Hello World"
    const parsed = {
      name: "hello.txt",
      path: "hello.txt",
      content: input,
      encoding: "base64",
      size: 11,
    };
    expect(decodeGitHubContent(parsed)).toBe("Hello World");
  });

  it("strips embedded newlines before decoding", () => {
    // GitHub wraps base64 at 60 chars with \n
    const wrapped = "SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0IGZpbGUgY29udGFpbmlu\nZyBtdWx0aXBsZSBsaW5lcyBvZiB0ZXh0Lg==";
    const parsed = {
      name: "test.txt",
      path: "test.txt",
      content: wrapped,
      encoding: "base64",
      size: 62,
    };
    // "Hello World! This is a test file containing multiple lines of text."
    const decoded = decodeGitHubContent(parsed);
    expect(decoded).toContain("Hello World!");
    expect(decoded).toContain("multiple lines");
    expect(decoded).not.toContain("\n");
  });

  it("decodes content with only a trailing newline", () => {
    const parsed = {
      name: "f.txt",
      path: "f.txt",
      content: "SGVsbG8=\n", // "Hello" with trailing \n
      encoding: "base64",
      size: 5,
    };
    expect(decodeGitHubContent(parsed)).toBe("Hello");
  });

  it("returns null for a non-contents object (repo response)", () => {
    const parsed = {
      full_name: "octocat/Hello-World",
      stargazers_count: 5,
      language: "TypeScript",
    };
    expect(decodeGitHubContent(parsed)).toBeNull();
  });

  it("returns null when encoding is not 'base64'", () => {
    const parsed = {
      name: "f.txt",
      content: "SGVsbG8=",
      encoding: "utf-8",
    };
    expect(decodeGitHubContent(parsed)).toBeNull();
  });

  it("returns null when content is not a string", () => {
    const parsed = {
      name: "f.txt",
      content: 12345,
      encoding: "base64",
    };
    expect(decodeGitHubContent(parsed)).toBeNull();
  });

  it("returns null for an array", () => {
    expect(decodeGitHubContent([{ encoding: "base64", content: "SGVsbG8=" }])).toBeNull();
  });

  it("returns null for null", () => {
    expect(decodeGitHubContent(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(decodeGitHubContent(undefined)).toBeNull();
  });

  it("returns null for a scalar", () => {
    expect(decodeGitHubContent("not an object")).toBeNull();
  });

  it("returns empty string when content is empty", () => {
    const parsed = {
      name: "empty.txt",
      path: "empty.txt",
      content: "",
      encoding: "base64",
      size: 0,
    };
    expect(decodeGitHubContent(parsed)).toBe("");
  });

  it("handles binary content gracefully (non-UTF8 bytes produce replacement chars)", () => {
    // base64 for 4 raw bytes: 0xFF 0xFE 0x00 0x00
    const parsed = {
      name: "binary.bin",
      path: "binary.bin",
      content: "//4AAA==",
      encoding: "base64",
      size: 4,
    };
    const result = decodeGitHubContent(parsed);
    expect(typeof result).toBe("string");
    // Should produce some output, not throw
    expect(result!.length).toBeGreaterThan(0);
  });
});
