import { homedir } from "node:os";
import type { Message } from "@earendil-works/pi-ai";
import { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  countLines,
  formatDuration,
  formatTokens,
  formatToolCall,
  getDisplayItemsFromMessages,
  previewTask,
} from "../src/lib/rendering.js";
import type { SubagentResult } from "../src/lib/types.js";
import { createResumeTool } from "../src/resume-tool.js";
import { createSubagentTool } from "../src/subagent-tool.js";

// ── Mock theme ─────────────────────────────────────────────────────────────

/** Strip ANSI escape codes from a string. */
function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes
  return s.replace(/\x1b\[[0-9;]*m/g, ""); // NOSONAR
}

/** Render a component to plain text at given width, stripping ANSI. */
function renderPlain(
  comp: { render: (width: number) => string[] },
  width = 80,
): string {
  return comp.render(width).map(stripAnsi).join("\n");
}

const mockTheme = new Theme(
  {
    accent: 33, // yellow
    border: 37,
    borderAccent: 37,
    borderMuted: 37,
    success: 32,
    error: 31,
    warning: 33,
    muted: 90,
    dim: 90,
    text: 37,
    thinkingText: 37,
    userMessageText: 37,
    customMessageText: 37,
    customMessageLabel: 37,
    toolTitle: 36, // cyan
    toolOutput: 37,
    mdHeading: 37,
    mdLink: 37,
    mdLinkUrl: 37,
    mdCode: 37,
    mdCodeBlock: 37,
    mdCodeBlockBorder: 37,
    mdQuote: 37,
    mdQuoteBorder: 37,
    mdHr: 37,
    mdListBullet: 37,
    toolDiffAdded: 37,
    toolDiffRemoved: 37,
    toolDiffContext: 37,
    syntaxComment: 37,
    syntaxKeyword: 37,
    syntaxFunction: 37,
    syntaxVariable: 37,
    syntaxString: 37,
    syntaxNumber: 37,
    syntaxType: 37,
    syntaxOperator: 37,
    syntaxPunctuation: 37,
    thinkingOff: 37,
    thinkingMinimal: 37,
    thinkingLow: 37,
    thinkingMedium: 37,
    thinkingHigh: 37,
    thinkingXhigh: 37,
    thinkingMax: 37,
    bashMode: 37,
  },
  {
    selectedBg: 40,
    userMessageBg: 40,
    customMessageBg: 40,
    toolPendingBg: 40,
    toolSuccessBg: 40,
    toolErrorBg: 40,
  },
  "truecolor",
);

// ── Stub result helpers ────────────────────────────────────────────────────

function makeResult(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    agent: "researcher",
    task: "Evaluate lucia-auth",
    output: "Lucia-auth is a lightweight auth library for Next.js.",
    exitCode: 0,
    elapsed: 3200,
    tokens: {
      input: 3200,
      output: 1300,
      cacheRead: 0,
      cacheWrite: 500,
      total: 4500,
      turns: 3,
    },
    model: "claude-sonnet-4-5",
    ...overrides,
  };
}

function makeParallelResult(children: SubagentResult[]): SubagentResult {
  const succeeded = children.filter((r) => r.exitCode === 0 && !r.error).length;
  return {
    agent: "parallel",
    task: `${children.length} tasks`,
    output: `Parallel: ${succeeded}/${children.length} succeeded.`,
    exitCode: children.every((r) => r.exitCode === 0) ? 0 : 1,
    elapsed: children.reduce((sum, r) => sum + r.elapsed, 0),
    tokens: {
      input: children.reduce((sum, r) => sum + r.tokens.input, 0),
      output: children.reduce((sum, r) => sum + r.tokens.output, 0),
      cacheRead: children.reduce((sum, r) => sum + r.tokens.cacheRead, 0),
      cacheWrite: children.reduce((sum, r) => sum + r.tokens.cacheWrite, 0),
      total: children.reduce((sum, r) => sum + r.tokens.total, 0),
      turns: children.reduce((sum, r) => sum + r.tokens.turns, 0),
    },
    results: children,
  };
}

// ── Formatting helpers ──────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(3200)).toBe("3.2s");
    expect(formatDuration(59_900)).toBe("59.9s");
  });

  it("formats minutes with seconds", () => {
    expect(formatDuration(60_000)).toBe("1m0s");
    expect(formatDuration(90_000)).toBe("1m30s");
    expect(formatDuration(125_000)).toBe("2m5s");
  });
});

describe("formatTokens", () => {
  it("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(4500)).toBe("4k");
    expect(formatTokens(9999)).toBe("9k");
    expect(formatTokens(99_900)).toBe("99k");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("previewTask", () => {
  it("returns short strings unchanged", () => {
    expect(previewTask("Fix the bug")).toBe("Fix the bug");
    expect(previewTask("a".repeat(80))).toBe("a".repeat(80));
  });

  it("truncates long strings at 80 chars", () => {
    const long = "a".repeat(100);
    expect(previewTask(long)).toBe(`${"a".repeat(77)}...`);
  });

  it("takes only the first line", () => {
    expect(previewTask("line1\nline2\nline3")).toBe("line1");
  });
});

describe("countLines", () => {
  it("counts empty string as 0", () => {
    expect(countLines("")).toBe(0);
  });

  it("counts single line", () => {
    expect(countLines("hello")).toBe(1);
  });

  it("counts multiple lines", () => {
    expect(countLines("a\nb\nc")).toBe(3);
  });

  it("counts trailing newline as extra line", () => {
    expect(countLines("a\n")).toBe(2);
  });
});

// ── formatToolCall ──────────────────────────────────────────────────────────

describe("formatToolCall", () => {
  it("formats bash with command preview", () => {
    const result = formatToolCall(
      "bash",
      { command: "npm test -- --coverage" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("$");
    expect(text).toContain("npm test -- --coverage");
  });

  it("formats bash with long command truncated", () => {
    const result = formatToolCall(
      "bash",
      { command: "a".repeat(80) },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("...");
    expect(text.length).toBeLessThan(80);
  });

  it("formats read with file path", () => {
    const homeTestPath = `${homedir()}/src/auth.ts`;
    const result = formatToolCall(
      "read",
      { file_path: homeTestPath },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("read");
    expect(text).toContain("~/src/auth.ts");
  });

  it("formats read with offset and limit", () => {
    const result = formatToolCall(
      "read",
      { file_path: "/tmp/foo.ts", offset: 42, limit: 10 },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain(":42-51");
  });

  it("formats write with line count", () => {
    const result = formatToolCall(
      "write",
      { file_path: "/tmp/foo.ts", content: "a\nb\nc\nd" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("write");
    expect(text).toContain("(4 lines)");
  });

  it("formats edit", () => {
    const result = formatToolCall(
      "edit",
      { file_path: "/app/config.ts" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("edit");
    expect(text).toContain("config.ts");
  });

  it("formats ls", () => {
    const result = formatToolCall("ls", { path: "/app/src" }, mockTheme);
    const text = stripAnsi(result);
    expect(text).toContain("ls");
    expect(text).toContain("/app/src");
  });

  it("formats find with pattern and path", () => {
    const result = formatToolCall(
      "find",
      { pattern: "*.test.ts", path: "/app/src" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("find");
    expect(text).toContain("*.test.ts");
    expect(text).toContain("/app/src");
  });

  it("formats grep with pattern and path", () => {
    const result = formatToolCall(
      "grep",
      { pattern: "TODO", path: "/app/src" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("grep");
    expect(text).toContain("/TODO/");
    expect(text).toContain("/app/src");
  });

  it("formats eval with language and code preview", () => {
    const result = formatToolCall(
      "eval",
      { language: "python", code: "print('hello')" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("eval");
    expect(text).toContain("python");
    expect(text).toContain("print('hello')");
  });

  it("formats gh_search with scope and query", () => {
    const result = formatToolCall(
      "gh_search",
      { scope: "code", query: "SubagentResult" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("gh_search");
    expect(text).toContain("code");
    expect(text).toContain("SubagentResult");
  });

  it("formats gh_fetch with url", () => {
    const result = formatToolCall(
      "gh_fetch",
      { url: "https://github.com/foo/bar" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("gh_fetch");
    expect(text).toContain("https://github.com/foo/bar");
  });

  it("formats WebFetch with url preview", () => {
    const result = formatToolCall(
      "WebFetch",
      { url: "https://example.com/docs/api" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("WebFetch");
    expect(text).toContain("https://example.com/docs/api");
  });

  it("formats WebSearch with query", () => {
    const result = formatToolCall(
      "WebSearch",
      { query: "TypeScript type guards" },
      mockTheme,
    );
    const text = stripAnsi(result);
    expect(text).toContain("WebSearch");
    expect(text).toContain("TypeScript type guards");
  });

  it("falls back to JSON for unknown tools", () => {
    const result = formatToolCall("custom_tool", { key: "value" }, mockTheme);
    const text = stripAnsi(result);
    expect(text).toContain("custom_tool");
    expect(text).toContain('"key":"value"');
  });
});

// ── getDisplayItemsFromMessages ─────────────────────────────────────────────

describe("getDisplayItemsFromMessages", () => {
  it("returns empty array for undefined messages", () => {
    expect(getDisplayItemsFromMessages(undefined)).toEqual([]);
  });

  it("returns empty array for empty messages", () => {
    expect(getDisplayItemsFromMessages([])).toEqual([]);
  });

  it("extracts tool calls from assistant messages", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check that file." },
          {
            type: "toolCall",
            id: "call_1",
            name: "read",
            arguments: { file_path: "/tmp/foo.ts" },
          },
        ],
      } as unknown as Message,
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "read",
        content: [{ type: "text", text: "file contents..." }],
        isError: false,
      } as unknown as Message,
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "call_2",
            name: "edit",
            arguments: { file_path: "/tmp/foo.ts" },
          },
        ],
      } as unknown as Message,
    ];
    const items = getDisplayItemsFromMessages(messages);
    expect(items).toHaveLength(2);
    expect(items[0]?.name).toBe("read");
    expect(items[0]?.args).toEqual({ file_path: "/tmp/foo.ts" });
    expect(items[1]?.name).toBe("edit");
  });

  it("skips thinking content blocks", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "...", thinkingSignature: "sig" },
        ],
      } as unknown as Message,
    ];
    expect(getDisplayItemsFromMessages(messages)).toEqual([]);
  });

  it("skips non-assistant messages", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "do something",
      } as unknown as Message,
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "bash",
        content: [{ type: "text", text: "output" }],
        isError: false,
      } as unknown as Message,
    ];
    expect(getDisplayItemsFromMessages(messages)).toEqual([]);
  });
});

describe("renderCall — subagent tool", () => {
  const tool = createSubagentTool();

  it("renders single mode with agent + task", () => {
    const comp = tool.renderCall!(
      { agent: "researcher", task: "Evaluate lucia-auth for project auth" },
      mockTheme,
      {} as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("subagent");
    expect(text).toContain("researcher");
    expect(text).toContain("Evaluate lucia-auth for project auth");
  });

  it("renders parallel mode with task count and agent names", () => {
    const comp = tool.renderCall!(
      {
        tasks: [
          { agent: "researcher", task: "Eval lucia" },
          { agent: "reviewer", task: "Check diff" },
          { agent: "implementer", task: "Fix bug" },
        ],
      },
      mockTheme,
      {} as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("subagent");
    expect(text).toContain("3 tasks");
    expect(text).toContain("researcher, reviewer, implementer");
  });

  it("deduplicates agent names in parallel display", () => {
    const comp = tool.renderCall!(
      {
        tasks: [
          { agent: "researcher", task: "Eval A" },
          { agent: "researcher", task: "Eval B" },
          { agent: "researcher", task: "Eval C" },
        ],
      },
      mockTheme,
      {} as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("3 tasks");
    // researcher should appear only once in the list
    const match = text.match(/researcher/g);
    expect(match).not.toBeNull();
    // One for the task count "3 tasks", one for the name list
    expect(match!.length).toBe(1);
  });

  it("shows +N for more than 3 unique agents", () => {
    const comp = tool.renderCall!(
      {
        tasks: [
          { agent: "a", task: "1" },
          { agent: "b", task: "2" },
          { agent: "c", task: "3" },
          { agent: "d", task: "4" },
          { agent: "e", task: "5" },
        ],
      },
      mockTheme,
      {} as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("5 tasks");
    expect(text).toContain("a, b, c");
    expect(text).toContain("+2");
  });

  it("renders fallback when no agent specified", () => {
    const comp = tool.renderCall!({}, mockTheme, {} as any);
    const text = renderPlain(comp);
    expect(text).toContain("no agent specified");
  });
});

describe("renderCall — resume tool", () => {
  const tool = createResumeTool();

  it("renders session basename", () => {
    const comp = tool.renderCall!(
      {
        session: "/tmp/pi-subagents/session-abc123.jsonl",
        task: "Continue work",
      },
      mockTheme,
      {} as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("resume");
    expect(text).toContain("session-abc123.jsonl");
  });
});

// ── renderResult — subagent tool ───────────────────────────────────────────

describe("renderResult — subagent tool", () => {
  const tool = createSubagentTool();

  it("renders running state when isPartial", () => {
    const result = {
      content: [{ type: "text" as const, text: "running..." }],
      details: makeResult({ exitCode: -1, output: "running..." }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: true },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("researcher");
    expect(text).toContain("running...");
  });

  it("renders collapsed success with first line and stats", () => {
    const result = {
      content: [
        {
          type: "text" as const,
          text: "Lucia-auth is a lightweight auth library for Next.js.",
        },
      ],
      details: makeResult(),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("researcher");
    expect(text).toContain("Lucia-auth is a lightweight auth library");
    expect(text).toContain("3.2s");
    expect(text).toContain("4k tok");
  });

  it("renders collapsed failure with error output", () => {
    const result = {
      content: [{ type: "text" as const, text: "Unknown agent" }],
      details: makeResult({
        exitCode: 1,
        error: 'Unknown agent "foo"',
        output: "Unknown agent",
      }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      { isError: true } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("researcher");
    expect(text).toContain("Unknown agent");
  });

  it("renders expanded view with full output and stats", () => {
    const result = {
      content: [
        {
          type: "text" as const,
          text: "Lucia-auth is a lightweight auth library for Next.js.",
        },
      ],
      details: makeResult(),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("researcher");
    expect(text).toContain(
      "Lucia-auth is a lightweight auth library for Next.js.",
    );
    expect(text).toContain("claude-sonnet-4-5");
    expect(text).toContain("3 turns");
    expect(text).toContain("4k tokens");
    expect(text).toContain("3k in");
    expect(text).toContain("1k out");
    expect(text).toContain("3.2s");
  });

  it("renders expanded parallel with per-agent breakdown", () => {
    const children = [
      makeResult({
        agent: "r1",
        output: "Result 1",
        elapsed: 1000,
        tokens: {
          input: 100,
          output: 200,
          cacheRead: 0,
          cacheWrite: 0,
          total: 300,
          turns: 1,
        },
      }),
      makeResult({
        agent: "r2",
        output: "Result 2",
        elapsed: 2000,
        tokens: {
          input: 300,
          output: 400,
          cacheRead: 0,
          cacheWrite: 0,
          total: 700,
          turns: 2,
        },
        exitCode: 1,
        error: "failed",
      }),
    ];
    const parallel = makeParallelResult(children);
    const result = {
      content: [{ type: "text" as const, text: "Parallel: 1/2 succeeded." }],
      details: parallel,
    };
    const comp = tool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      { isError: true } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("2 agents");
    expect(text).toContain("r1");
    expect(text).toContain("r2");
    expect(text).toContain("failed");
    expect(text).toContain("1/2 succeeded");
  });

  it("renders collapsed with expand hint for multi-line output", () => {
    const multiLine = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7";
    const result = {
      content: [{ type: "text" as const, text: multiLine }],
      details: makeResult({ output: multiLine }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("Line 1");
    expect(text).toContain("to expand"); // expand hint present
  });

  it("renders expanded view with tool calls from messages", () => {
    const result = {
      content: [
        {
          type: "text" as const,
          text: "Done.",
        },
      ],
      details: makeResult({
        output: "Done.",
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call_1",
                name: "read",
                arguments: { file_path: "/tmp/foo.ts", offset: 10, limit: 5 },
              },
            ],
          } as unknown as Message,
          {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "read",
            content: [{ type: "text", text: "..." }],
            isError: false,
          } as unknown as Message,
          {
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
          } as unknown as Message,
        ],
      }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("─── Tool calls ───");
    expect(text).toContain("read");
    expect(text).toContain("foo.ts");
  });

  it("renders without details fallback", () => {
    const result: any = {
      content: [{ type: "text" as const, text: "Some raw output" }],
      details: undefined,
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("Some raw output");
  });

  it("renders running state without details", () => {
    const result: any = {
      content: [{ type: "text" as const, text: "" }],
      details: undefined,
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: true },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("running...");
  });
});

// ── renderResult — resume tool ─────────────────────────────────────────────

describe("renderResult — resume tool", () => {
  const tool = createResumeTool();

  it("renders running state when isPartial", () => {
    const result = {
      content: [{ type: "text" as const, text: "running..." }],
      details: makeResult({
        agent: "implementer",
        exitCode: -1,
        output: "running...",
      }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: true },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("implementer");
    expect(text).toContain("running...");
  });

  it("renders collapsed success with first line and stats", () => {
    const output = "Applied fix to src/auth/validate.ts. Tests pass.";
    const result = {
      content: [{ type: "text" as const, text: output }],
      details: makeResult({
        agent: "implementer",
        output,
        elapsed: 5400,
        tokens: { ...makeResult().tokens, total: 8200 },
      }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("implementer");
    expect(text).toContain("Applied fix to src/auth/validate.ts");
    expect(text).toContain("5.4s");
    expect(text).toContain("8k tok");
  });

  it("renders collapsed failure with error output", () => {
    const result = {
      content: [{ type: "text" as const, text: "Session not found" }],
      details: makeResult({
        agent: "implementer",
        exitCode: 1,
        error: "Session file not found",
        output: "Session not found",
      }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      { isError: true } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("implementer");
    expect(text).toContain("Session not found");
  });

  it("renders expanded view with full output and stats", () => {
    const result = {
      content: [
        {
          type: "text" as const,
          text: "Applied fix to src/auth/validate.ts. All 12 tests pass.",
        },
      ],
      details: makeResult({
        agent: "implementer",
        output: "Applied fix to src/auth/validate.ts. All 12 tests pass.",
      }),
    };
    const comp = tool.renderResult!(
      result,
      { expanded: true, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("implementer");
    expect(text).toContain(
      "Applied fix to src/auth/validate.ts. All 12 tests pass.",
    );
    expect(text).toContain("claude-sonnet-4-5");
    expect(text).toContain("3 turns");
    expect(text).toContain("3.2s");
  });

  it("renders without details fallback", () => {
    const result: any = {
      content: [{ type: "text" as const, text: "Resumed session completed." }],
      details: undefined,
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("Resumed session completed.");
  });

  it("renders running state without details", () => {
    const result: any = {
      content: [{ type: "text" as const, text: "" }],
      details: undefined,
    };
    const comp = tool.renderResult!(
      result,
      { expanded: false, isPartial: true },
      mockTheme,
      { isError: false } as any,
    );
    const text = renderPlain(comp);
    expect(text).toContain("running...");
  });
});
