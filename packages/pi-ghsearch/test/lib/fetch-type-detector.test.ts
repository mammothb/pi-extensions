import { describe, expect, it } from "vitest";
import { detectFetchType } from "../../src/lib/fetch-type-detector.js";

describe("detectFetchType", () => {
  it("detects a file from Contents API response", () => {
    const result = detectFetchType({
      name: "README.md",
      path: "README.md",
      size: 1234,
      encoding: "base64",
      content: "SGVsbG8=",
    });
    expect(result.type).toBe("file");
    expect(result.summary).toContain("[file]");
    expect(result.summary).toContain("README.md");
  });

  it("detects a file with just content (no encoding)", () => {
    const result = detectFetchType({
      name: "index.ts",
      path: "src/index.ts",
      size: 500,
      content: "console.log('hello');",
    });
    expect(result.type).toBe("file");
    expect(result.summary).toContain("[file]");
    expect(result.summary).toContain("src/index.ts");
  });

  it("detects a commit", () => {
    const result = detectFetchType({
      sha: "abc1234567890def",
      commit: {
        message: "fix: resolve bug in parser",
        author: { name: "Jane Dev" },
      },
      author: { login: "janedev" },
    });
    expect(result.type).toBe("commit");
    expect(result.summary).toContain("[commit]");
    expect(result.summary).toContain("abc1234");
    expect(result.summary).toContain("fix: resolve bug in parser");
  });

  it("detects a PR", () => {
    const result = detectFetchType({
      number: 42,
      title: "Add new feature",
      state: "open",
      draft: false,
    });
    expect(result.type).toBe("pr");
    expect(result.summary).toContain("[pr]");
    expect(result.summary).toContain("#42");
    expect(result.summary).toContain("Add new feature");
  });

  it("detects a merged PR", () => {
    const result = detectFetchType({
      number: 100,
      title: "Merged PR",
      state: "closed",
      merged: true,
    });
    expect(result.type).toBe("pr");
    expect(result.summary).toContain("merged");
  });

  it("detects an issue", () => {
    const result = detectFetchType({
      number: 7,
      title: "Bug report",
      state: "open",
      comments: 3,
    });
    expect(result.type).toBe("issue");
    expect(result.summary).toContain("[issue]");
    expect(result.summary).toContain("#7");
    expect(result.summary).toContain("Bug report");
    expect(result.summary).toContain("3 comments");
  });

  it("detects a repo using full_name and stargazers_count", () => {
    const result = detectFetchType({
      full_name: "org/repo",
      stargazers_count: 100,
      forks_count: 25,
      language: "TypeScript",
      description: "A great repo",
    });
    expect(result.type).toBe("repo");
    expect(result.summary).toContain("[repo]");
    expect(result.summary).toContain("org/repo");
    expect(result.summary).toContain("stars: 100");
    expect(result.summary).toContain("A great repo");
  });

  it("detects a repo using camelCase fields", () => {
    const result = detectFetchType({
      fullName: "org/repo",
      stargazersCount: 50,
      language: "Rust",
    });
    expect(result.type).toBe("repo");
    expect(result.summary).toContain("[repo]");
    expect(result.summary).toContain("org/repo");
    expect(result.summary).toContain("stars: 50");
  });

  it("returns unknown for an empty array", () => {
    const result = detectFetchType([]);
    expect(result.type).toBe("unknown");
    expect(result.summary).toBe("empty list");
  });

  it("returns unknown with count for a non-empty array", () => {
    const result = detectFetchType([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(result.type).toBe("unknown");
    expect(result.summary).toBe("3 items");
  });

  it("returns unknown with field count for an unrecognized object", () => {
    const result = detectFetchType({ foo: "bar", baz: 42 });
    expect(result.type).toBe("unknown");
    expect(result.summary).toContain("fields");
  });

  it("returns unknown for null", () => {
    const result = detectFetchType(null);
    expect(result.type).toBe("unknown");
    expect(result.summary).toBe("");
  });

  it("returns unknown for undefined", () => {
    const result = detectFetchType(undefined);
    expect(result.type).toBe("unknown");
    expect(result.summary).toBe("");
  });

  it("returns unknown for a primitive string", () => {
    const result = detectFetchType("just a string");
    expect(result.type).toBe("unknown");
    expect(result.summary).toBe("");
  });

  it("returns unknown for a number", () => {
    const result = detectFetchType(42);
    expect(result.type).toBe("unknown");
    expect(result.summary).toBe("");
  });

  it("prioritizes file detection over other types", () => {
    // An object that has both file-like and issue-like fields
    const result = detectFetchType({
      name: "README.md",
      path: "README.md",
      size: 100,
      content: "hello",
      number: 1,
      title: "not an issue",
      state: "open",
    });
    expect(result.type).toBe("file");
  });
});
