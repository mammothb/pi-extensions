import { describe, expect, it } from "vitest";
import {
  compilePatterns,
  compileWildcardPattern,
  findCompiledWildcardMatch,
} from "../../src/lib/wildcard.js";

describe("compileWildcardPattern", () => {
  it("matches literal strings", () => {
    const compiled = compileWildcardPattern("git status");
    expect(compiled.regex.test("git status")).toBe(true);
    expect(compiled.regex.test("git stash")).toBe(false);
    expect(compiled.regex.test("git status ")).toBe(false);
  });

  it("matches * within a single path segment", () => {
    const compiled = compileWildcardPattern("git *");
    expect(compiled.regex.test("git status")).toBe(true);
    expect(compiled.regex.test("git push origin main")).toBe(true);
    // * does not cross /
    expect(compiled.regex.test("git/push")).toBe(false);
  });

  it("matches ** across path segments", () => {
    const compiled = compileWildcardPattern("**/.env");
    expect(compiled.regex.test(".env")).toBe(true);
    expect(compiled.regex.test("src/.env")).toBe(true);
    expect(compiled.regex.test("a/b/c/.env")).toBe(true);
    expect(compiled.regex.test(".env.backup")).toBe(false);
  });

  it("matches ? as a single character", () => {
    const compiled = compileWildcardPattern("file?.ts");
    expect(compiled.regex.test("file1.ts")).toBe(true);
    expect(compiled.regex.test("fileA.ts")).toBe(true);
    expect(compiled.regex.test("file.ts")).toBe(false);
    expect(compiled.regex.test("file12.ts")).toBe(false);
  });

  it("normalizes backslashes to forward slashes", () => {
    const compiled = compileWildcardPattern("src\\foo\\bar.ts");
    expect(compiled.pattern).toBe("src/foo/bar.ts");
    expect(compiled.regex.test("src/foo/bar.ts")).toBe(true);
    expect(compiled.regex.test("src\\foo\\bar.ts")).toBe(false);
  });

  it("escapes regex metacharacters", () => {
    const compiled = compileWildcardPattern("git push .+");
    // The .+ should be literal, not a regex quantifier
    expect(compiled.regex.test("git push .+")).toBe(true);
    expect(compiled.regex.test("git push ..")).toBe(false);
  });

  it("matches combined wildcards", () => {
    const compiled = compileWildcardPattern("**/node_modules/**");
    expect(compiled.regex.test("node_modules/foo")).toBe(true);
    expect(compiled.regex.test("project/node_modules/foo/bar")).toBe(true);
    expect(compiled.regex.test("src/node_modules")).toBe(true);
    expect(compiled.regex.test("node_modules_backup/foo")).toBe(false);
  });
});

describe("compilePatterns", () => {
  it("compiles a record of patterns with state", () => {
    const compiled = compilePatterns({
      "*.ts": "allow",
      "*.js": "deny",
    });

    expect(compiled).toHaveLength(2);
    expect(compiled[0]!.state).toBe("allow");
    expect(compiled[1]!.state).toBe("deny");
  });
});

describe("findCompiledWildcardMatch", () => {
  it("returns the last matching pattern (last-match-wins)", () => {
    const compiled = compilePatterns({
      "*": "ask",
      eval: "allow",
    });

    const match = findCompiledWildcardMatch(compiled, "eval");
    expect(match).not.toBeNull();
    expect(match!.state).toBe("allow");
    expect(match!.pattern).toBe("eval");
  });

  it("returns the last match when multiple patterns match", () => {
    const compiled = compilePatterns({
      "git *": "ask",
      "git status": "allow",
    });

    const match = findCompiledWildcardMatch(compiled, "git status");
    expect(match).not.toBeNull();
    expect(match!.state).toBe("allow");
  });

  it("returns null when no pattern matches", () => {
    const compiled = compilePatterns({
      "git *": "ask",
    });

    const match = findCompiledWildcardMatch(compiled, "npm test");
    expect(match).toBeNull();
  });

  it("matches wildcards correctly", () => {
    const compiled = compilePatterns({
      "context7_*": "allow",
    });

    expect(
      findCompiledWildcardMatch(compiled, "context7_search"),
    ).not.toBeNull();
    expect(
      findCompiledWildcardMatch(compiled, "context7_fetch"),
    ).not.toBeNull();
    expect(findCompiledWildcardMatch(compiled, "eval")).toBeNull();
  });

  it("preserves the matched pattern name", () => {
    const compiled = compilePatterns({
      "**/.env": "deny",
    });

    const match = findCompiledWildcardMatch(compiled, "project/.env");
    expect(match).not.toBeNull();
    expect(match!.pattern).toBe("**/.env");
    expect(match!.matchedInput).toBe("project/.env");
  });
});
