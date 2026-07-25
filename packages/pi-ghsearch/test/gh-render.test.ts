import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { createGhAuthStatusTool } from "../src/gh-auth-status.js";
import { createGhFetchTool } from "../src/gh-fetch.js";
import { createGhSearchTool } from "../src/gh-search.js";
import { createMockPi } from "./_helpers/mock-pi.js";

// ---------------------------------------------------------------------------
// Mock theme (same pattern as pi-ask / pi-shared / pi-eval tests)
// ---------------------------------------------------------------------------

function mockTheme(): Theme {
  const mk = {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
    bg: (color: string, text: string) => `[bg:${color}]${text}[/bg:${color}]`,
    bold: (text: string) => `[bold]${text}[/bold]`,
    italic: (text: string) => `[italic]${text}[/italic]`,
    underline: (text: string) => `[underline]${text}[/underline]`,
    inverse: (text: string) => `[inverse]${text}[/inverse]`,
    strikethrough: (text: string) => `[strikethrough]${text}[/strikethrough]`,
  };
  return mk as unknown as Theme;
}

const theme = mockTheme();

function textContent(text: string) {
  return { type: "text" as const, text };
}

/** Erase types for test detail objects that omit runtime-irrelevant fields. */
const d = (x: unknown) => x as any;

/** Join all rendered lines into a single string for assertion. */
function renderText(rendered: Component): string {
  return (rendered as Text).render(500).join("\n");
}

/** Get first rendered line. */
function _renderLine(rendered: Component): string {
  return (rendered as Text).render(500)[0] ?? "";
}

// ===========================================================================
// gh_auth_status — render tests
// ===========================================================================

function makeAuthStatusTool() {
  const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
  return createGhAuthStatusTool(pi as any, DEFAULT_CONFIG);
}

describe("gh_auth_status — renderCall", () => {
  it("renders bold tool name", () => {
    const tool = makeAuthStatusTool();
    const result = tool.renderCall!({}, theme, {} as any);
    expect(renderText(result)).toContain(
      "[toolTitle][bold]gh_auth_status[/bold][/toolTitle]",
    );
  });
});

describe("gh_auth_status — renderResult", () => {
  it("renders authenticated state with hostname and user", () => {
    const tool = makeAuthStatusTool();
    const result = tool.renderResult!(
      {
        content: [textContent("Logged in to github.com as someuser")],
        details: d({ authenticated: true }),
      },
      {} as any,
      theme,
      { isError: false, args: {} } as any,
    );
    expect(renderText(result)).toContain(
      "[muted]Authenticated to github.com as someuser[/muted]",
    );
  });

  it("renders authenticated state with GHE hostname", () => {
    const tool = makeAuthStatusTool();
    const result = tool.renderResult!(
      {
        content: [textContent("Logged in to gh.internal.com as dev")],
        details: d({ authenticated: true }),
      },
      {} as any,
      theme,
      { isError: false, args: {} } as any,
    );
    expect(renderText(result)).toContain(
      "[muted]Authenticated to gh.internal.com as dev[/muted]",
    );
  });

  it("renders not authenticated state with raw message", () => {
    const tool = makeAuthStatusTool();
    const result = tool.renderResult!(
      {
        content: [textContent("not logged in")],
        details: d({ authenticated: false }),
      },
      {} as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[error]![/error]");
    expect(text).toContain("[warning]Not authenticated[/warning]");
    expect(text).toContain("[muted]not logged in[/muted]");
  });

  it("renders not authenticated state without raw message when (no output)", () => {
    const tool = makeAuthStatusTool();
    const result = tool.renderResult!(
      {
        content: [textContent("(no output)")],
        details: d({ authenticated: false }),
      },
      {} as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[error]![/error]");
    expect(text).toContain("[warning]Not authenticated[/warning]");
    // Should not append the raw "(no output)" message
    expect(text.split("[warning]Not authenticated[/warning]")[1]).not.toContain(
      "(no output)",
    );
  });

  it("renders error state via renderError", () => {
    const tool = makeAuthStatusTool();
    const result = tool.renderResult!(
      {
        content: [textContent("gh: command not found")],
        details: d({}),
      },
      {} as any,
      theme,
      { isError: true, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain(
      "[error]gh_auth_status: gh: command not found[/error]",
    );
  });
});

// ===========================================================================
// gh_fetch — render tests
// ===========================================================================

function makeFetchTool() {
  const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
  return createGhFetchTool(pi as any, DEFAULT_CONFIG);
}

describe("gh_fetch — renderCall", () => {
  it("renders tool name and GitHub URL path", () => {
    const tool = makeFetchTool();
    const result = tool.renderCall!(
      { url: "https://github.com/octocat/Hello-World/pull/42" },
      theme,
      {} as any,
    );
    const text = renderText(result);
    expect(text).toContain("[toolTitle][bold]gh_fetch [/bold][/toolTitle]");
    expect(text).toContain("[muted]octocat/Hello-World/pull/42[/muted]");
  });

  it("shows API endpoint mapping for GitHub URLs", () => {
    const tool = makeFetchTool();
    const result = tool.renderCall!(
      { url: "https://github.com/octocat/Hello-World" },
      theme,
      {} as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]->[/muted]");
    expect(text).toContain("[muted]repos/octocat/Hello-World[/muted]");
  });

  it("handles invalid URLs gracefully (no crash, just shows raw URL)", () => {
    const tool = makeFetchTool();
    const result = tool.renderCall!(
      { url: "not-a-valid-url!!!" },
      theme,
      {} as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]not-a-valid-url!!![/muted]");
    // Should NOT crash and should NOT show endpoint
    expect(text).not.toContain("->");
  });

  it("renders gist.github.com URLs (full URL, no path shortening)", () => {
    const tool = makeFetchTool();
    const result = tool.renderCall!(
      { url: "https://gist.github.com/octocat/abc123" },
      theme,
      {} as any,
    );
    const text = renderText(result);
    // gist.github.com is not in the shortener list — full URL is shown
    expect(text).toContain(
      "[muted]https://gist.github.com/octocat/abc123[/muted]",
    );
  });
});

describe("gh_fetch — renderResult", () => {
  it("renders error state via renderError", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      { content: [textContent("Not Found")], details: d({}) },
      { expanded: false } as any,
      theme,
      { isError: true, args: {} } as any,
    );
    expect(renderText(result)).toContain("[error]gh_fetch: Not Found[/error]");
  });

  it("renders expanded view with raw text and collapse hint", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      {
        content: [textContent('{"name":"test"}')],
        details: d({ parsed: { name: "test" } }),
      },
      { expanded: true } as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain('{"name":"test"}');
    expect(text).toContain("Ctrl+O to collapse");
  });

  it("renders collapsed view with JSON repo summary", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: {
            full_name: "org/repo",
            stargazers_count: 42,
            language: "TS",
          },
          endpoint: "repos/org/repo",
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    // detectFetchType produces a summary for repo objects
    expect(text).toContain("[muted]");
    expect(text).toContain("to expand");
  });

  it("renders collapsed view with issue summary", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: { number: 123, title: "Fix bug", state: "open" },
          endpoint: "repos/org/repo/issues/123",
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]");
  });

  it("renders collapsed view with truncation notice", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("truncated...")],
        details: d({
          parsed: { full_name: "org/repo" },
          endpoint: "repos/org/repo",
          truncation: {
            truncated: true,
            outputBytes: 51200,
            totalBytes: 200000,
          },
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[warning]! truncated");
  });

  it("renders collapsed view with unknown type and endpoint fallback", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: { some_random_field: "x" },
          endpoint: "repos/org/repo/contents/path",
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]repos/org/repo/contents/path");
  });

  it("renders empty response gracefully", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("")],
        details: d({ parsed: undefined }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]empty response[/muted]");
    expect(text).toContain("to expand");
  });

  it("renders empty response with endpoint label", () => {
    const tool = makeFetchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("")],
        details: d({ parsed: undefined, endpoint: "repos/org/repo" }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: {} } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]repos/org/repo — empty response[/muted]");
  });
});

// ===========================================================================
// gh_search — render tests
// ===========================================================================

function makeSearchTool() {
  const pi = createMockPi({ stdout: "", stderr: "", code: 0 });
  return createGhSearchTool(pi as any, DEFAULT_CONFIG);
}

describe("gh_search — renderCall", () => {
  it("renders tool name, scope, and query", () => {
    const tool = makeSearchTool();
    const result = tool.renderCall!(
      { scope: "repos", query: "topic:mcp" },
      theme,
      {} as any,
    );
    const text = renderText(result);
    expect(text).toContain("[toolTitle][bold]gh_search[/bold][/toolTitle]");
    expect(text).toContain("[muted]repos[/muted]");
    expect(text).toContain("[muted]topic:mcp[/muted]");
  });
});

describe("gh_search — renderResult", () => {
  it("renders error state via renderError", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      { content: [textContent("rate limited")], details: d({}) },
      { expanded: false } as any,
      theme,
      { isError: true, args: { scope: "repos" } } as any,
    );
    expect(renderText(result)).toContain(
      "[error]gh_search: rate limited[/error]",
    );
  });

  it("renders expanded view with raw text and collapse hint", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("raw search output")],
        details: d({ parsed: [] }),
      },
      { expanded: true } as any,
      theme,
      { isError: false, args: { scope: "repos" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("raw search output");
    expect(text).toContain("Ctrl+O to collapse");
  });

  it("renders code scope with file count", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [
          textContent(
            "README.md\n some content\nCONTRIBUTING.md\n more content",
          ),
        ],
        details: d({ parsed: undefined }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "code" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[accent]2[/accent]");
    expect(text).toContain("[muted]files[/muted]");
  });

  it("renders code scope with no matching files", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("")],
        details: d({ parsed: undefined }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "code" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[accent]0[/accent]");
  });

  it("renders code scope with truncation notice", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("file1.rs\n content")],
        details: d({
          parsed: undefined,
          truncation: {
            truncated: true,
            outputBytes: 10000,
            totalBytes: 50000,
          },
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "code" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[warning]! truncated");
  });

  it("renders empty JSON results with 'no X found'", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("[]")],
        details: d({ parsed: [] }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "repos" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]— no repos found[/muted]");
  });

  it("renders single repo result (singular label)", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: [
            {
              fullName: "org/repo",
              stargazersCount: 10,
              language: "TypeScript",
            },
          ],
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "repos" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[accent]1[/accent]");
    expect(text).toContain("[muted]repo[/muted]"); // singular
    expect(text).toContain("org/repo");
    expect(text).not.toContain("more");
  });

  it("renders multiple repo results (plural label with +N more)", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: [
            { fullName: "a/b", stargazersCount: 1, language: "Rust" },
            { fullName: "c/d", stargazersCount: 2, language: "Go" },
            { fullName: "e/f", stargazersCount: 3, language: "Zig" },
          ],
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "repos" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[accent]3[/accent]");
    expect(text).toContain("[muted]repos[/muted]"); // plural
    expect(text).toContain("[muted]+2 more[/muted]");
  });

  it("renders issue result with correct format", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: [{ number: 42, title: "Fix bug", state: "open" }],
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "issues" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("#42 Fix bug (open)");
  });

  it("renders PR result with draft label", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: [{ number: 7, title: "WIP", isDraft: true }],
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "prs" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("#7 WIP (draft)");
  });

  it("renders commit result with shortened SHA and message", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({
          parsed: [
            {
              sha: "abc123def456",
              commit: { message: "Fix: resolve null pointer\n\nDetails..." },
            },
          ],
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "commits" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("abc123d"); // first 7 chars
    expect(text).toContain("Fix: resolve null pointer");
  });

  it("renders JSON results with truncation notice", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("[]")],
        details: d({
          parsed: [
            { fullName: "org/repo", stargazersCount: 1, language: "TS" },
          ],
          truncation: { truncated: true, outputBytes: 1000, totalBytes: 10000 },
        }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "repos" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[warning]! truncated");
  });
});

// ===========================================================================
// formatFirstItem edge cases (tested via renderResult)
// ===========================================================================

describe("gh_search — formatFirstItem edge cases", () => {
  it("handles missing fields in repo item", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({ parsed: [{}] }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "repos" } } as any,
    );
    const text = renderText(result);
    // Uses fallback values
    expect(text).toContain("? (stars: ?, no lang)");
  });

  it("handles missing fields in commit item", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({ parsed: [{ sha: "1234567890" }] }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "commits" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("1234567"); // shortened SHA
  });

  it("falls back to item identity for unknown scope", () => {
    const tool = makeSearchTool();
    const result = tool.renderResult!(
      {
        content: [textContent("{}")],
        details: d({ parsed: [{ number: 99 }] }),
      },
      { expanded: false } as any,
      theme,
      { isError: false, args: { scope: "unknown_scope" } } as any,
    );
    const text = renderText(result);
    expect(text).toContain("99");
  });
});
