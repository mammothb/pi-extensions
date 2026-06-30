import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createGhSearchTool } from "../src/gh-search.js";
import { createMockPi } from "./_helpers/mock-pi.js";

describe("gh_search tool", () => {
  it("registers with the expected name", () => {
    const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);
    expect(tool.name).toBe("gh_search");
  });

  it("calls gh search code with the query", async () => {
    const pi = createMockPi({
      stdout: "search results here",
      stderr: "",
      code: 0,
    });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { scope: "code", query: "org:pi-dev topic:mcp" },
      undefined,
      undefined,
      { cwd: "/tmp" } as any,
    );

    expect(pi.exec).toHaveBeenCalledWith(
      "gh",
      ["search", "code", "org:pi-dev topic:mcp", "--limit", "30"],
      expect.objectContaining({
        cwd: "/tmp",
        timeout: DEFAULT_CONFIG.timeoutMs,
      }),
    );
    expect(result.content[0]?.type).toBe("text");
    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toContain("search results here");
    }
  });

  it("includes --json with default fields for repos scope", async () => {
    const pi = createMockPi({ stdout: "[]", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { scope: "repos", query: "topic:mcp" },
      undefined,
      undefined,
      {} as any,
    );

    expect(pi.exec).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--json", expect.stringContaining("fullName")]),
      expect.anything(),
    );
  });

  it("skips --json for code scope", async () => {
    const pi = createMockPi({
      stdout: "raw code results",
      stderr: "",
      code: 0,
    });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { scope: "code", query: "function" },
      undefined,
      undefined,
      {} as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs).not.toContain("--json");
  });

  it("passes optional flags when provided", async () => {
    const pi = createMockPi({ stdout: "[]", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      {
        scope: "repos",
        query: "topic:mcp",
        limit: 10,
        owner: ["my-org"],
        language: "typescript",
        sort: "stars",
        order: "desc",
      },
      undefined,
      undefined,
      {} as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs).toContain("--limit");
    expect(callArgs).toContain("10");
    expect(callArgs).toContain("--owner");
    expect(callArgs).toContain("my-org");
    expect(callArgs).toContain("--language");
    expect(callArgs).toContain("typescript");
    expect(callArgs).toContain("--sort");
    expect(callArgs).toContain("stars");
    expect(callArgs).toContain("--order");
    expect(callArgs).toContain("desc");
  });

  it("passes issue-specific flags", async () => {
    const pi = createMockPi({ stdout: "[]", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      {
        scope: "issues",
        query: "bug",
        state: "open",
        author: "someuser",
        assignee: "devuser",
        label: ["bug", "high-priority"],
      },
      undefined,
      undefined,
      {} as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs).toContain("--state");
    expect(callArgs).toContain("open");
    expect(callArgs).toContain("--author");
    expect(callArgs).toContain("someuser");
    expect(callArgs).toContain("--assignee");
    expect(callArgs).toContain("devuser");
    expect(callArgs).toContain("--label");
    expect(callArgs).toContain("bug");
    expect(callArgs).toContain("--label");
    expect(callArgs).toContain("high-priority");
  });

  it("throws an error on non-zero exit code", async () => {
    const pi = createMockPi({
      stdout: "",
      stderr: "gh: authentication required",
      code: 1,
    });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await expect(
      tool.execute(
        "call-1",
        { scope: "code", query: "test" },
        undefined,
        undefined,
        {} as any,
      ),
    ).rejects.toThrow("authentication required");
  });

  it("pretty-prints JSON output", async () => {
    const raw = JSON.stringify([{ fullName: "org/repo", stargazersCount: 5 }]);
    const pi = createMockPi({ stdout: raw, stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { scope: "repos", query: "test" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      // Should be pretty-printed with newlines and indentation
      expect(result.content[0].text).toContain('"fullName"');
      expect(result.content[0].text).toContain("\n");
    }
    expect(result.details.parsed).toEqual([
      { fullName: "org/repo", stargazersCount: 5 },
    ]);
  });

  it("keeps raw text when output is not JSON", async () => {
    const raw = "line1\nline2\nline3";
    const pi = createMockPi({ stdout: raw, stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { scope: "code", query: "test" },
      undefined,
      undefined,
      {} as any,
    );

    if (result.content[0]?.type === "text") {
      expect(result.content[0].text).toBe(raw);
    }
    expect(result.details.parsed).toBeUndefined();
  });

  it("uses custom fields when provided", async () => {
    const pi = createMockPi({ stdout: "[]", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { scope: "repos", query: "test", fields: "name,url" },
      undefined,
      undefined,
      {} as any,
    );

    expect(pi.exec).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["--json", "name,url"]),
      expect.anything(),
    );
  });

  it("passes --jq when provided for non-code scope", async () => {
    const pi = createMockPi({ stdout: "[]", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { scope: "repos", query: "test", jq: ".[].fullName" },
      undefined,
      undefined,
      {} as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs).toContain("--jq");
    expect(callArgs).toContain(".[].fullName");
  });

  it("skips --jq for code scope", async () => {
    const pi = createMockPi({
      stdout: "raw code results",
      stderr: "",
      code: 0,
    });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { scope: "code", query: "function", jq: ".[].name" },
      undefined,
      undefined,
      {} as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs).not.toContain("--jq");
  });

  it("strips language:xxx from query when language param is set", async () => {
    const pi = createMockPi({
      stdout: "raw code results",
      stderr: "",
      code: 0,
    });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      {
        scope: "code",
        query: "glob::glob clap path wildcard language:rust",
        language: "rust",
      },
      undefined,
      undefined,
      { cwd: "/tmp" } as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    // language:rust should be stripped from the query
    expect(callArgs[2]).toBe("glob::glob clap path wildcard");
    // --language should still be passed
    expect(callArgs).toContain("--language");
    expect(callArgs).toContain("rust");
  });

  it("strips owner:xxx from query when owner param is set", async () => {
    const pi = createMockPi({ stdout: "[]", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { scope: "repos", query: "topic:mcp owner:my-org", owner: ["my-org"] },
      undefined,
      undefined,
      {} as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs[2]).toBe("topic:mcp");
  });

  it("strips multiple repo:xxx from query when repo param is set", async () => {
    const pi = createMockPi({ stdout: "[]", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      {
        scope: "code",
        query: "fix repo:org/a repo:org/b",
        repo: ["org/a", "org/b"],
      },
      undefined,
      undefined,
      {} as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs[2]).toBe("fix");
  });

  it("throws when query becomes empty after stripping all qualifiers", async () => {
    const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await expect(
      tool.execute(
        "call-1",
        { scope: "code", query: "language:rust", language: "rust" },
        undefined,
        undefined,
        {} as any,
      ),
    ).rejects.toThrow("Query has no search terms");
  });

  it("strips quoted qualifier values", async () => {
    const pi = createMockPi({
      stdout: "raw code results",
      stderr: "",
      code: 0,
    });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      {
        scope: "code",
        query: 'bug label:"good first issue"',
        label: ["good first issue"],
      },
      undefined,
      undefined,
      { cwd: "/tmp" } as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    expect(callArgs[2]).toBe("bug");
  });

  it("does not strip qualifiers that differ from explicit params", async () => {
    const pi = createMockPi({
      stdout: "raw code results",
      stderr: "",
      code: 0,
    });
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    await tool.execute(
      "call-1",
      { scope: "code", query: "fix language:typescript", language: "rust" },
      undefined,
      undefined,
      { cwd: "/tmp" } as any,
    );

    const callArgs = pi.exec.mock.calls[0]?.[1] as string[];
    // language:typescript should NOT be stripped because the param says rust
    expect(callArgs[2]).toBe("fix language:typescript");
  });

  it("includes truncation notice when output is truncated", async () => {
    // Generate output over the 50KB default to trigger truncation
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
    const tool = createGhSearchTool(pi as any, DEFAULT_CONFIG);

    const result = await tool.execute(
      "call-1",
      { scope: "repos", query: "test" },
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
});
