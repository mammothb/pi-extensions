import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createEvalTool } from "../src/eval.js";

// ---------------------------------------------------------------------------
// Mock theme (same pattern as pi-ask and pi-shared tests)
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
const tool = createEvalTool();

// Helpers to build result/content objects
function textContent(text: string) {
  return { type: "text" as const, text };
}

function makeResult(content: string, details?: unknown) {
  return {
    content: [textContent(content)],
    details: details ?? {
      language: "javascript",
      exitCode: 0,
      exitSignal: null,
    },
  };
}

/**
 * Join all rendered lines into a single string for assertion.
 * Uses wide width so mock theme markup doesn't cause artificial wrapping.
 */
function renderText(rendered: Text, width = 500): string {
  return rendered.render(width).join("\n");
}

/**
 * Get first rendered line (for stats-header assertions).
 * Uses wide width so single-line content doesn't wrap.
 */
function renderLine(rendered: Text, width = 500): string {
  return rendered.render(width)[0] ?? "";
}

// ===========================================================================
// renderCall
// ===========================================================================

describe("renderCall", () => {
  it("shows (js) badge for JavaScript", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "javascript", code: "1+1" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain("[syntaxKeyword](js)[/syntaxKeyword]");
  });

  it("shows (py) badge for Python", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "python", code: "print(1)" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain("[syntaxKeyword](py)[/syntaxKeyword]");
  });

  it("renders code preview (single line)", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "javascript", code: "console.log('hello world')" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain(
      "[toolOutput]console.log('hello world')[/toolOutput]",
    );
  });

  it("truncates long first line and appends ...", () => {
    const longCode = `${"x".repeat(70)}\nsecond line`;
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "javascript", code: longCode },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain(`[toolOutput]${"x".repeat(65)}...[/toolOutput]`);
  });

  it("appends ... for multi-line code even when first line is short", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "python", code: "print(1)\nprint(2)" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain("[toolOutput]print(1)...[/toolOutput]");
  });

  it("shows (no code) for empty code", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "javascript", code: "" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain("[toolOutput](no code)[/toolOutput]");
  });

  it("shows (no code) for whitespace-only code", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "javascript", code: "   \t  " },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain("[toolOutput](no code)[/toolOutput]");
  });

  it("shows cwd hint when cwd differs from ctx.cwd", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "python", code: "print(1)", cwd: "/other" },
      theme,
      ctx,
    );
    const text = renderText(result);
    // Note: cwdHint has a leading space: ` (cwd: /other)`
    expect(text).toContain("[muted] (cwd: /other)[/muted]");
  });

  it("does not show cwd hint when cwd matches ctx.cwd", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "python", code: "print(1)", cwd: "/project" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).not.toContain("(cwd:");
  });

  it("does not show cwd hint when cwd is undefined", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "python", code: "print(1)" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).not.toContain("(cwd:");
  });

  it("includes bold eval title", () => {
    const ctx = { cwd: "/project", lastComponent: new Text("", 0, 0) } as any;
    const result = tool.renderCall!(
      { language: "javascript", code: "1" },
      theme,
      ctx,
    );
    const line = renderLine(result);
    expect(line).toContain("[toolTitle][bold]eval[/bold][/toolTitle]");
  });
});

// ===========================================================================
// renderResult — partial (running) state
// ===========================================================================

describe("renderResult — partial/running state", () => {
  it("shows evaluating... when isPartial and not error", () => {
    const result = tool.renderResult!(
      makeResult(""),
      { isPartial: true, expanded: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[muted]evaluating...[/muted]");
  });
});

// ===========================================================================
// renderResult — expanded view
// ===========================================================================

describe("renderResult — expanded view", () => {
  it("shows stats header with exit code and line count", () => {
    const raw = "STDOUT:\nhello\nworld";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: true, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[success]exit 0[/success]");
    expect(line).toContain("[muted]| 2 lines[/muted]");
  });

  it("shows raw text in expanded view", () => {
    const raw = "STDOUT:\nhello\nworld";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: true, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    // renderText pads each line to full width — trim to check content
    const full = renderText(result);
    const trimmed = full
      .split("\n")
      .map((l) => l.trimEnd())
      .join("\n");
    expect(trimmed).toContain(raw);
  });

  it("shows collapse hint in expanded view", () => {
    const raw = "STDOUT:\nhello";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: true, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const full = renderText(result);
    expect(full).toContain("[muted] to collapse[/muted]");
  });

  it("expanded view: exit code 1 shows error color", () => {
    const raw = "STDERR:\noops";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 1,
        exitSignal: null,
      }),
      { expanded: true, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[error]exit 1[/error]");
  });

  it("expanded view: killed by signal", () => {
    const raw = "[Process killed by signal: SIGTERM]\nSTDOUT:\npartial";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "python",
        exitCode: null,
        exitSignal: "SIGTERM",
      }),
      { expanded: true, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[error]killed by SIGTERM[/error]");
  });
});

// ===========================================================================
// renderResult — collapsed view
// ===========================================================================

describe("renderResult — collapsed view", () => {
  it("shows stats header and preview lines", () => {
    const raw = "STDOUT:\nline1\nline2\nline3\nline4\nline5\nline6";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const full = renderText(result);
    // Has stats header (on first line)
    expect(full).toContain("[success]exit 0[/success]");
    expect(full).toContain("| 6 lines");
    // Has preview lines (first 5 non-empty)
    expect(full).toContain("line1");
    expect(full).toContain("line5");
    // Has expand hint for remaining lines
    expect(full).toContain("more lines");
  });

  it("shows no expand hint when all lines fit in preview", () => {
    const raw = "STDOUT:\nline1\nline2";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const full = renderText(result);
    // Should not have "more lines" expand hint (2 lines fit in 5-line preview)
    expect(full).not.toContain("more lines");
    // But should have expand key hint at bottom
    expect(full).toContain("to expand");
  });

  it("filters blank/whitespace lines from preview", () => {
    const raw = "STDOUT:\n\n\n  \nline1\nline2";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const full = renderText(result);
    // Blank lines should not be in preview
    expect(full).toContain("line1");
    expect(full).toContain("line2");
  });

  it("shows truncated marker in stats when output was truncated", () => {
    // parseOutput regex requires ^STDOUT: at start — truncated marker before
    // STDOUT prevents stdout extraction. Use STDOUT-first format.
    const raw = "STDOUT:\nline1\nline2\n[Output truncated at 1 MB]";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[warning]| truncated[/warning]");
  });
});

// ===========================================================================
// renderResult — no output
// ===========================================================================

describe("renderResult — no output", () => {
  it("shows '| no output' when previewSource is empty (truly empty STDOUT)", () => {
    // STDOUT with only whitespace — parseOutput captures "" then trimmed to ""
    const raw = "STDOUT:\n";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[muted]| no output[/muted]");
    // No expand hint for no output
    expect(line).not.toContain("to expand");
  });

  it("treats (no output) string as one line of content (not 'no output' flag)", () => {
    // parseOutput extracts "(no output)" as stdout content → 1 line
    const raw = "STDOUT:\n(no output)";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[muted]| 1 lines[/muted]");
  });
});

// ===========================================================================
// renderResult — error paths
// ===========================================================================

describe("renderResult — error paths", () => {
  it("uses stderr for preview on error (exitCode != 0)", () => {
    const raw = "STDOUT:\nok\n\nSTDERR:\nerror msg";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 1,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const full = renderText(result);
    // Should preview stderr content
    expect(full).toContain("error msg");
    expect(full).toContain("[error]exit 1[/error]");
  });

  it("falls back to stdout for preview when stderr is empty on error", () => {
    const raw = "STDOUT:\nstdout content";
    const details = { language: "javascript", exitCode: 1, exitSignal: null };
    const result = tool.renderResult!(
      makeResult(raw, details),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const full = renderText(result);
    expect(full).toContain("stdout content");
    expect(full).toContain("[error]exit 1[/error]");
  });

  it("shows killed by signal in error state", () => {
    const raw = "[Process killed by signal: SIGKILL]\nSTDOUT:\npartial";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "python",
        exitCode: null,
        exitSignal: "SIGKILL",
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("[error]killed by SIGKILL[/error]");
  });

  it("ctx.isError=true with no details shows first line of error text", () => {
    const raw = "STDERR:\nsome error occurred";
    const result = tool.renderResult!(
      { content: [textContent(raw)], details: undefined },
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: true } as any,
    );
    const line = renderLine(result);
    // Should show first line from rawText, not "exit 0"
    expect(line).toContain("[error]STDERR:[/error]");
  });

  it("error view always shows expand hint in header", () => {
    const raw = "STDERR:\noops";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 1,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    // Error state → expand hint appears in stats header
    expect(line).toContain("to expand");
  });
});

// ===========================================================================
// renderResult — parseOutput edge cases
// ===========================================================================

describe("renderResult — parseOutput edge cases", () => {
  it("handles raw text with no STDOUT/STDERR markers", () => {
    const raw = "just plain text";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    // Should still render without crashing
    expect(line).toContain("exit 0");
  });

  it("handles empty raw text", () => {
    const raw = "";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    // No output scenario
    expect(line).toContain("no output");
  });

  it("handles STDOUT with signal marker", () => {
    const raw = "[Process killed by signal: SIGTERM]\nSTDOUT:\ndata";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "python",
        exitCode: null,
        exitSignal: "SIGTERM",
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("killed by SIGTERM");
  });
});

// ===========================================================================
// renderResult — countLines edge cases
// ===========================================================================

describe("renderResult — countLines edge cases", () => {
  it("counts lines correctly for single-line output", () => {
    const raw = "STDOUT:\nsingle line only";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: true, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("| 1 lines");
  });

  it("shows '| 2 lines' for two-line output", () => {
    const raw = "STDOUT:\nline1\nline2";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: true, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("| 2 lines");
  });
});

// ===========================================================================
// renderResult — buildStatsLine edge cases
// ===========================================================================

describe("renderResult — buildStatsLine edge cases", () => {
  it("shows exit code when details are available", () => {
    const raw = "STDOUT:\noutput";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 7,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    expect(line).toContain("exit 7");
  });

  it("shows truncated marker only when actually truncated", () => {
    const rawNotTruncated = "STDOUT:\noutput";
    const result1 = tool.renderResult!(
      makeResult(rawNotTruncated, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line1 = renderLine(result1);
    expect(line1).not.toContain("truncated");

    const rawTruncated = "STDOUT:\noutput\n[Output truncated at 1 MB]";
    const result2 = tool.renderResult!(
      makeResult(rawTruncated, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line2 = renderLine(result2);
    expect(line2).toContain("truncated");
  });
});

// ===========================================================================
// renderResult — empty preview source
// ===========================================================================

describe("renderResult — empty preview source", () => {
  it("handles stdout-only output with empty non-empty lines", () => {
    // STDOUT present but with no actual content or only whitespace
    const raw = "STDOUT:\n\n  \n\t";
    const result = tool.renderResult!(
      makeResult(raw, {
        language: "javascript",
        exitCode: 0,
        exitSignal: null,
      }),
      { expanded: false, isPartial: false } as any,
      theme,
      { isError: false } as any,
    );
    const line = renderLine(result);
    // Should show no output since no non-empty lines
    expect(line).toContain("no output");
  });
});
