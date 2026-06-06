import { afterEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { WebsearchConfig } from "../src/config";
import { DEFAULT_CONFIG } from "../src/config";
import type { SearchArgs } from "../src/lib/types";
import { WebsearchParameters } from "../src/lib/types";
import { createWebsearchTool } from "../src/websearch";

// Mock the providers module
vi.mock("../src/lib/providers", () => ({
  createProvider: vi.fn(),
}));

import { createProvider } from "../src/lib/providers";

const mockCreateProvider = vi.mocked(createProvider);

afterEach(() => {
  vi.clearAllMocks();
});

function buildTool(config: WebsearchConfig = DEFAULT_CONFIG) {
  const mockSearch = vi.fn();
  mockCreateProvider.mockReturnValue({ name: "mock", search: mockSearch });
  const tool = createWebsearchTool(config);
  return { tool, mockSearch };
}

// ---------------------------------------------------------------------------
// execute — default parameters
// ---------------------------------------------------------------------------

describe("execute — default parameters", () => {
  it("applies defaults when only query is provided", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockResolvedValue("result");

    await tool.execute(
      "call-1",
      { query: "test" },
      undefined,
      vi.fn(),
      {} as any,
    );

    const receivedArgs = mockSearch.mock.calls[0]![0] as SearchArgs;
    expect(receivedArgs).toEqual({
      query: "test",
      type: "auto",
      numResults: 8,
      livecrawl: "fallback",
      contextMaxCharacters: 10000,
    });
  });
});

// ---------------------------------------------------------------------------
// execute — custom parameters
// ---------------------------------------------------------------------------

describe("execute — custom parameters", () => {
  it("passes all custom parameters through to provider", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockResolvedValue("result");

    await tool.execute(
      "call-1",
      {
        query: "custom query",
        type: "deep",
        numResults: 15,
        livecrawl: "preferred",
        contextMaxCharacters: 5000,
      },
      undefined,
      vi.fn(),
      {} as any,
    );

    const receivedArgs = mockSearch.mock.calls[0]![0] as SearchArgs;
    expect(receivedArgs).toEqual({
      query: "custom query",
      type: "deep",
      numResults: 15,
      livecrawl: "preferred",
      contextMaxCharacters: 5000,
    });
  });

  it("applies default contextMaxCharacters from config when not provided", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockResolvedValue("result");

    await tool.execute(
      "call-1",
      { query: "test" },
      undefined,
      vi.fn(),
      {} as any,
    );

    const receivedArgs = mockSearch.mock.calls[0]![0] as SearchArgs;
    expect(receivedArgs.contextMaxCharacters).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// execute — success / fallback
// ---------------------------------------------------------------------------

describe("execute — results", () => {
  it("returns content with text on success", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockResolvedValue("some result");

    const result = await tool.execute(
      "call-1",
      { query: "test" },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect(result).toEqual({
      content: [{ type: "text", text: "some result" }],
      details: { query: "test" },
    });
  });

  it("returns fallback text when provider returns undefined", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockResolvedValue(undefined);

    const result = await tool.execute(
      "call-1",
      { query: "fallback query" },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: "No search results found. Please try a different query.",
      },
    ]);
  });

  it("sets details.query to the input query even on fallback", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockResolvedValue(undefined);

    const result = await tool.execute(
      "call-1",
      { query: "my query" },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect(result.details).toEqual({ query: "my query" });
  });
});

// ---------------------------------------------------------------------------
// execute — error handling
// ---------------------------------------------------------------------------

describe("execute — error handling", () => {
  it("wraps Error throws", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockRejectedValue(new Error("boom"));

    await expect(
      tool.execute("call-1", { query: "test" }, undefined, vi.fn(), {} as any),
    ).rejects.toThrow("Web search failed: boom");
  });

  it("stringifies non-Error throws", async () => {
    const { tool, mockSearch } = buildTool();
    mockSearch.mockRejectedValue("raw string");

    await expect(
      tool.execute("call-1", { query: "test" }, undefined, vi.fn(), {} as any),
    ).rejects.toThrow("Web search failed: raw string");
  });
});

// ---------------------------------------------------------------------------
// renderCall
// ---------------------------------------------------------------------------

describe("renderCall", () => {
  // Create a simple mock Theme that tags colors for test assertions
  function mockTheme(): Theme {
    return {
      fg: (color: string, text: string) => `[${color}:${text}]`,
      bold: (text: string) => `[B:${text}]`,
    } as unknown as Theme;
  }

  it("returns a Text component containing the query", () => {
    const { tool } = buildTool();
    const theme = mockTheme();

    const result = tool.renderCall!({ query: "hello world" }, theme, {} as any);

    const lines = result.render(80);
    const joined = lines.join("");
    expect(joined).toContain("hello world");
    expect(joined).toContain("websearch");
  });
});

// ---------------------------------------------------------------------------
// renderResult
// ---------------------------------------------------------------------------

describe("renderResult", () => {
  function mockTheme(): Theme {
    return {
      fg: (color: string, text: string) => `[${color}:${text}]`,
      bold: (text: string) => `[B:${text}]`,
    } as unknown as Theme;
  }

  const resultPayload = {
    content: [{ type: "text" as const, text: "search result content" }],
    details: { query: "test query" },
  };

  it('returns "Searching..." when isPartial is true', () => {
    const { tool } = buildTool();
    const theme = mockTheme();

    const result = tool.renderResult!(
      resultPayload,
      { isPartial: true, expanded: false },
      theme,
      {} as any,
    );

    const lines = result.render(80);
    expect(lines.some((l) => l.includes("Searching..."))).toBe(true);
  });

  it("renders the query title and content when expanded", () => {
    const { tool } = buildTool();
    const theme = mockTheme();

    const result = tool.renderResult!(
      resultPayload,
      { isPartial: false, expanded: true },
      theme,
      {} as any,
    );

    const lines = result.render(80);
    const joined = lines.join("");
    expect(joined).toContain("test query");
    expect(joined).toContain("search result content");
  });

  it("renders a collapsed preview for long content", () => {
    const { tool } = buildTool();
    const theme = mockTheme();

    // Generate content with many lines to trigger collapsing
    const longContent = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`).join("\n");
    const payload = {
      content: [{ type: "text" as const, text: longContent }],
      details: { query: "big query" },
    };

    const result = tool.renderResult!(
      payload,
      { isPartial: false, expanded: false },
      theme,
      {} as any,
    );

    const lines = result.render(80);
    const joined = lines.join("");
    // Should show "more lines" hint since 20 lines > 7 preview lines
    expect(joined).toContain("more lines");
    expect(joined).toContain("to expand");
    // Should show the query
    expect(joined).toContain("big query");
  });

  it("renders full content without 'more lines' hint when content fits", () => {
    const { tool } = buildTool();
    const theme = mockTheme();

    const shortContent = "just two lines\nof text";
    const payload = {
      content: [{ type: "text" as const, text: shortContent }],
      details: { query: "small query" },
    };

    const result = tool.renderResult!(
      payload,
      { isPartial: false, expanded: false },
      theme,
      {} as any,
    );

    const lines = result.render(80);
    const joined = lines.join("");
    expect(joined).toContain("just two lines");
    expect(joined).toContain("of text");
    // Should NOT have the "more lines" hint
    expect(joined).not.toContain("more lines");
  });

  it("renders title but no content when textContent is empty", () => {
    const { tool } = buildTool();
    const theme = mockTheme();

    const payload = {
      content: [{ type: "text" as const, text: "" }],
      details: { query: "empty result" },
    };

    const result = tool.renderResult!(
      payload,
      { isPartial: false, expanded: false },
      theme,
      {} as any,
    );

    const lines = result.render(80);
    const joined = lines.join("");
    // Title should be present
    expect(joined).toContain("empty result");
  });

  it("filters out a trailing empty line in collapsed preview", () => {
    const { tool } = buildTool();
    const theme = mockTheme();

    // Content ending with a newline creates a trailing empty element
    const content = "hello\nworld\n";
    const payload = {
      content: [{ type: "text" as const, text: content }],
      details: { query: "trailing query" },
    };

    const result = tool.renderResult!(
      payload,
      { isPartial: false, expanded: false },
      theme,
      {} as any,
    );

    const lines = result.render(80);
    const joined = lines.join("");
    expect(joined).toContain("hello");
    expect(joined).toContain("world");
  });
});


