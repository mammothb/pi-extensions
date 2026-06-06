import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createGhFetchTool } from "../src/gh-fetch.js";
import { createMockPi } from "./_helpers/mock-pi.js";

describe("gh_fetch tool", () => {
  it("registers with the expected name", () => {
    const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);
    expect(tool.name).toBe("gh_fetch");
  });

  it("throws on gh api error", async () => {
    const pi = createMockPi({
      stdout: "",
      stderr: "Not Found",
      code: 1,
    });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    await expect(
      tool.execute(
        "call-1",
        { url: "https://github.com/octocat/Hello-World" },
        undefined,
        undefined,
        {} as any,
      ),
    ).rejects.toThrow("Not Found");
  });

  it("pretty-prints JSON response", async () => {
    const raw = JSON.stringify({ name: "Hello-World", stargazers_count: 5 });
    const pi = createMockPi({ stdout: raw, stderr: "", code: 0 });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain('"name"');
      expect(result.content[0].text).toContain("\n");
    }
    expect(result.details.parsed).toEqual({
      name: "Hello-World",
      stargazers_count: 5,
    });
  });

  it("keeps raw text when output is not JSON", async () => {
    const raw = "# Hello\n\nThis is markdown.";
    const pi = createMockPi({ stdout: raw, stderr: "", code: 0 });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World/readme" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toBe(raw);
    }
    expect(result.details.parsed).toBeUndefined();
  });

  it("includes endpoint in details", async () => {
    const pi = createMockPi({ stdout: "{}", stderr: "", code: 0 });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World/pull/42" },
      undefined,
      undefined,
      {} as any,
    );

    expect(result.details.endpoint).toBe("repos/octocat/Hello-World/pulls/42");
    expect(result.details.command).toEqual([
      "gh",
      "api",
      "repos/octocat/Hello-World/pulls/42",
    ]);
  });

  it("includes truncation notice and fullOutputPath when output is truncated", async () => {
    const item = { name: "x".repeat(200) };
    const largeArray = Array.from({ length: 300 }, (_, i) => ({
      ...item,
      id: i,
    }));
    const pi = createMockPi({
      stdout: JSON.stringify(largeArray),
      stderr: "",
      code: 0,
    });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("[Output truncated:");
      expect(result.content[0].text).toContain("Full output saved to:");
    }
    expect(result.details.truncation).toBeDefined();
    expect(result.details.truncation?.truncated).toBe(true);
    expect(result.details.fullOutputPath).toBeDefined();
    expect(result.details.fullOutputPath).toContain("pi-ghsearch-");
  });

  it("auto-decodes base64 content from GitHub Contents API responses", async () => {
    const contentsResponse = JSON.stringify({
      name: "README.md",
      path: "docs/README.md",
      content: "IyBIZWxsbyBXb3JsZAoKVGhpcyBpcyBhIHRlc3QuCg==",
      encoding: "base64",
      size: 32,
      sha: "abc123",
    });
    const pi = createMockPi({
      stdout: contentsResponse,
      stderr: "",
      code: 0,
    });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      {
        url: "https://github.com/octocat/Hello-World/blob/main/docs/README.md",
      },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(
        "--- Decoded file content (docs/README.md) ---",
      );
      expect(result.content[0].text).toContain("# Hello World");
      expect(result.content[0].text).toContain("This is a test.");
      // The JSON metadata should still be present
      expect(result.content[0].text).toContain('"name"');
      expect(result.content[0].text).toContain('"encoding"');
    }
    // details.parsed should still be the original JSON, not the appended text
    expect(result.details.parsed).toEqual({
      name: "README.md",
      path: "docs/README.md",
      content: "IyBIZWxsbyBXb3JsZAoKVGhpcyBpcyBhIHRlc3QuCg==",
      encoding: "base64",
      size: 32,
      sha: "abc123",
    });
  });

  it("does not modify non-contents API responses", async () => {
    const repoResponse = JSON.stringify({
      full_name: "octocat/Hello-World",
      stargazers_count: 5,
      language: "TypeScript",
    });
    const pi = createMockPi({
      stdout: repoResponse,
      stderr: "",
      code: 0,
    });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).not.toContain("--- Decoded file content");
      expect(result.content[0].text).toContain('"full_name"');
    }
  });

  it("auto-decodes content with embedded newlines (GitHub 60-char wrapping)", async () => {
    // Simulate GitHub's 60-char base64 wrapping
    const wrappedBase64 =
      "IyBIZWxsbyBXb3JsZCEgVGhpcyBpcyBhIHRlc3QgZmlsZSBjb250YWluaW5nIG11bHRp\ncGxlIGxpbmVzIG9mIHRleHQu";
    const contentsResponse = JSON.stringify({
      name: "test.txt",
      path: "test.txt",
      content: wrappedBase64,
      encoding: "base64",
      size: 62,
    });
    const pi = createMockPi({
      stdout: contentsResponse,
      stderr: "",
      code: 0,
    });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World/blob/main/test.txt" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("# Hello World!");
      expect(result.content[0].text).toContain("multiple lines");
    }
  });

  it("auto-decodes empty content", async () => {
    const contentsResponse = JSON.stringify({
      name: "empty.txt",
      path: "empty.txt",
      content: "",
      encoding: "base64",
      size: 0,
    });
    const pi = createMockPi({
      stdout: contentsResponse,
      stderr: "",
      code: 0,
    });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World/blob/main/empty.txt" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain(
        "--- Decoded file content (empty.txt) ---",
      );
    }
  });

  it("still truncates when decoded content makes output too large", async () => {
    // Create a Contents API response with very large decoded content
    const largeText = "x".repeat(100_000);
    const largeBase64 = Buffer.from(largeText).toString("base64");
    const contentsResponse = JSON.stringify({
      name: "large.txt",
      path: "large.txt",
      content: largeBase64,
      encoding: "base64",
      size: 100_000,
    });
    const pi = createMockPi({
      stdout: contentsResponse,
      stderr: "",
      code: 0,
    });
    const tool = createGhFetchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { url: "https://github.com/octocat/Hello-World/blob/main/large.txt" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("[Output truncated:");
    }
    expect(result.details.truncation).toBeDefined();
    expect(result.details.fullOutputPath).toBeDefined();
  });
});
