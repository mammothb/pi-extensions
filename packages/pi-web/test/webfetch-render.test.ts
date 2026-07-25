import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createWebfetchTool } from "../src/webfetch.js";

// ---------------------------------------------------------------------------
// Mock theme
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

/** Render a Text component to a string. Containers return themselves. */
function renderText(rendered: any): string {
  if (rendered?.render && typeof rendered.render === "function") {
    return rendered.render(500).join("\n");
  }
  return String(rendered ?? "");
}

// ===========================================================================
// renderCall
// ===========================================================================

describe("WebFetch — renderCall", () => {
  it("renders tool name and URL", () => {
    const tool = createWebfetchTool();
    const result = tool.renderCall!(
      { url: "https://example.com/page" },
      theme,
      {} as any,
    );
    const text = renderText(result);
    expect(text).toContain("[toolTitle][bold]WebFetch [/bold][/toolTitle]");
    expect(text).toContain("[muted]https://example.com/page[/muted]");
  });
});

// ===========================================================================
// renderResult — Text-based paths (no Markdown dependency)
// ===========================================================================

describe("WebFetch — renderResult (Text paths)", () => {
  it("shows fetching state when partial and no URL", () => {
    const tool = createWebfetchTool();
    const result = tool.renderResult!(
      { content: [], details: {} },
      { isPartial: true, expanded: false } as any,
      theme,
      { isError: false } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]Fetching...[/muted]");
  });

  it("renders error state via renderError", () => {
    const tool = createWebfetchTool();
    const result = tool.renderResult!(
      { content: [textContent("Network error")], details: {} },
      { expanded: false } as any,
      theme,
      { isError: true } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[error]WebFetch: Network error[/error]");
  });

  it("renders image result with title and size", () => {
    const tool = createWebfetchTool();
    const result = tool.renderResult!(
      {
        content: [],
        details: {
          url: "https://example.com/photo.png",
          displayTitle: "photo.png",
          isImage: true,
          size: 12345,
          contentType: "image/png",
          format: "markdown",
        },
      },
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[muted]Image: photo.png");
    // formatSize shows size info
    expect(text).toContain("12.1KB");
  });

  it("renders error details when details.error is true", () => {
    const tool = createWebfetchTool();
    const result = tool.renderResult!(
      {
        content: [],
        details: {
          url: "https://example.com",
          error: true,
          errorSummary: "Connection refused",
          contentType: "",
          format: "markdown",
          displayTitle: "https://example.com",
        },
      },
      { expanded: false } as any,
      theme,
      { isError: false } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[error]WebFetch: Connection refused[/error]");
  });

  it("renders error with fallback message when no errorSummary", () => {
    const tool = createWebfetchTool();
    const result = tool.renderResult!(
      {
        content: [],
        details: {
          url: "https://example.com",
          error: true,
          contentType: "",
          format: "markdown",
          displayTitle: "https://example.com",
        },
      },
      { expanded: false } as any,
      theme,
      { isError: false } as any,
    );
    const text = renderText(result);
    expect(text).toContain("[error]WebFetch: Request failed[/error]");
  });
});

// ===========================================================================
// renderResult — Container-based paths (returns Container, not deeply rendered)
// ===========================================================================

describe("WebFetch — renderResult (Container paths)", () => {
  it("returns a Container for collapsed markdown content (does not throw)", () => {
    const tool = createWebfetchTool();
    expect(() =>
      tool.renderResult!(
        {
          content: [textContent("# Hello\n\nWorld")],
          details: {
            url: "https://example.com",
            displayTitle: "example.com",
            contentType: "text/html",
            format: "markdown",
            size: 512,
          },
        },
        { expanded: false } as any,
        theme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });

  it("returns a Container for expanded markdown content (does not throw)", () => {
    const tool = createWebfetchTool();
    expect(() =>
      tool.renderResult!(
        {
          content: [textContent("# Title\n\nParagraph")],
          details: {
            url: "https://example.com",
            displayTitle: "example.com",
            contentType: "text/html",
            format: "markdown",
            size: 100,
          },
        },
        { expanded: true } as any,
        theme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });

  it("returns a Container for text format content (does not throw)", () => {
    const tool = createWebfetchTool();
    expect(() =>
      tool.renderResult!(
        {
          content: [textContent("plain text")],
          details: {
            url: "https://example.com",
            displayTitle: "example.com",
            contentType: "text/plain",
            format: "text",
            size: 50,
          },
        },
        { expanded: false } as any,
        theme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });

  it("returns a Container for HTML format content (does not throw)", () => {
    const tool = createWebfetchTool();
    expect(() =>
      tool.renderResult!(
        {
          content: [textContent("<h1>Title</h1>")],
          details: {
            url: "https://example.com",
            displayTitle: "example.com",
            contentType: "text/html",
            format: "html",
            size: 100,
          },
        },
        { expanded: false } as any,
        theme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });

  it("returns a Container for content with no size available", () => {
    const tool = createWebfetchTool();
    expect(() =>
      tool.renderResult!(
        {
          content: [textContent("content")],
          details: {
            url: "https://example.com",
            displayTitle: "example.com",
            contentType: "text/html",
            format: "markdown",
          },
        },
        { expanded: false } as any,
        theme,
        { isError: false } as any,
      ),
    ).not.toThrow();
  });
});
