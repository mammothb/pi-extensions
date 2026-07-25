import { describe, expect, it } from "vitest";
import { extractPath, summarizeToolArgs } from "../src/lib/recall/tool-args.js";

describe("extractPath", () => {
  it("extracts 'path' key", () => {
    expect(extractPath({ path: "/foo/bar.ts" })).toBe("/foo/bar.ts");
  });

  it("extracts 'file_path' key", () => {
    expect(extractPath({ file_path: "/etc/config" })).toBe("/etc/config");
  });

  it("extracts 'filePath' key", () => {
    expect(extractPath({ filePath: "./src/main.ts" })).toBe("./src/main.ts");
  });

  it("extracts 'file' key", () => {
    expect(extractPath({ file: "README.md" })).toBe("README.md");
  });

  it("prefers 'path' over other keys (first match wins)", () => {
    expect(
      extractPath({ path: "/a", file_path: "/b", filePath: "/c", file: "/d" }),
    ).toBe("/a");
  });

  it("returns null when no matching key", () => {
    expect(extractPath({ foo: "bar", baz: 123 })).toBeNull();
  });

  it("skips non-string values for matching keys", () => {
    expect(extractPath({ path: 123, file: true })).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(extractPath({})).toBeNull();
  });
});

describe("summarizeToolArgs", () => {
  it("returns path=... when path is present", () => {
    expect(summarizeToolArgs({ path: "/src/app.ts" })).toBe("path=/src/app.ts");
  });

  it("returns path=... when file is present", () => {
    expect(summarizeToolArgs({ file: "config.json" })).toBe("path=config.json");
  });

  it("returns command=... when no path but command is string", () => {
    expect(summarizeToolArgs({ command: "ls -la" })).toBe("command=ls -la");
  });

  it("returns query=... when no path and no command but query is string", () => {
    expect(summarizeToolArgs({ query: "topic:mcp" })).toBe("query=topic:mcp");
  });

  it("returns comma-separated keys when no recognized args", () => {
    expect(summarizeToolArgs({ foo: 1, bar: 2, baz: "x" })).toBe(
      "foo, bar, baz",
    );
  });

  it("returns empty string for empty args", () => {
    expect(summarizeToolArgs({})).toBe("");
  });

  it("prioritizes path over command and query", () => {
    expect(
      summarizeToolArgs({
        path: "/file.ts",
        command: "ls",
        query: "search",
      }),
    ).toBe("path=/file.ts");
  });

  it("falls through to command when path is non-string", () => {
    expect(summarizeToolArgs({ path: 123, command: "git log" })).toBe(
      "command=git log",
    );
  });
});
