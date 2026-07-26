import { homedir } from "node:os";
import type { Message } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Box, Text } from "@earendil-works/pi-tui";
import {
  BgSafeTruncatedText,
  getCollapseHint,
  getExpandHint,
  PREVIEW_LINES,
} from "@mammothb/pi-shared";
import type { SubagentResult } from "./types.js";

// ── Formatting helpers ─────────────────────────────────────────────────────

/** Format milliseconds as human-readable duration. */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

/** Format token count with k/M suffix. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${Math.floor(n / 100_000) / 10}M`;
  }
  if (n >= 1000) {
    return `${Math.floor(n / 1000)}k`;
  }
  return String(n);
}

/** Build a single-line stats string for the result line. */
export function statsLine(r: SubagentResult, theme: Theme): string {
  const parts: string[] = [];
  if (r.elapsed > 0) {
    parts.push(formatDuration(r.elapsed));
  }
  if (r.tokens.total > 0) {
    parts.push(`${formatTokens(r.tokens.total)} tok`);
  }
  return parts.length > 0 ? theme.fg("muted", ` · ${parts.join(" · ")}`) : "";
}

/** Build a detailed stats block for expanded view. */
export function expandedStats(r: SubagentResult, theme: Theme): string {
  const lines: string[] = [];
  if (r.model) {
    lines.push(`model: ${r.model}`);
  }
  if (r.tokens.turns > 0) {
    lines.push(`${r.tokens.turns} turns`);
  }
  lines.push(
    `${formatTokens(r.tokens.total)} tokens ` +
      `(${formatTokens(r.tokens.input)} in, ${formatTokens(r.tokens.output)} out)`,
  );
  if (r.elapsed > 0) {
    lines.push(formatDuration(r.elapsed));
  }
  lines.push(getCollapseHint(theme));
  return lines.join(theme.fg("muted", " · "));
}

/** Truncate task text for display — first line, capped at 80 chars. */
export function previewTask(task: string): string {
  const firstLine = task.split("\n")[0] ?? "";
  if (firstLine.length <= 80) {
    return firstLine;
  }
  return `${firstLine.slice(0, 77)}...`;
}

/** Count lines in a string (including empty). */
export function countLines(s: string): number {
  if (!s) {
    return 0;
  }
  let count = 1;
  for (const ch of s) {
    if (ch === "\n") {
      count++;
    }
  }
  return count;
}

// ── Shared renderers ────────────────────────────────────────────────────────

// ── Display item extraction ─────────────────────────────────────────────────

interface DisplayItem {
  type: "toolCall";
  name: string;
  args: Record<string, unknown>;
}

function shortenPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? `${s.slice(0, maxLen)}...` : s;
}

// =============================================================================
// Tool call formatters (dispatch table to keep cognitive complexity low)
// =============================================================================

type ToolFormatter = (args: Record<string, unknown>, theme: Theme) => string;

function fmtBash(args: Record<string, unknown>, theme: Theme): string {
  const command = (args.command as string) || "...";
  const preview = truncate(command, 60);
  return theme.fg("muted", "$ ") + theme.fg("toolOutput", preview);
}

function fmtRead(args: Record<string, unknown>, theme: Theme): string {
  const rawPath = (args.file_path || args.path || "...") as string;
  const filePath = shortenPath(rawPath);
  const offset = args.offset as number | undefined;
  const limit = args.limit as number | undefined;
  let text = theme.fg("accent", filePath);
  if (offset !== undefined || limit !== undefined) {
    const startLine = offset ?? 1;
    const endSuffix = limit !== undefined ? `-${startLine + limit - 1}` : "";
    text += theme.fg("warning", `:${startLine}${endSuffix}`);
  }
  return theme.fg("muted", "read ") + text;
}

function fmtWrite(args: Record<string, unknown>, theme: Theme): string {
  const rawPath = (args.file_path || args.path || "...") as string;
  const filePath = shortenPath(rawPath);
  const content = (args.content || "") as string;
  const lines = content.split("\n").length;
  let text = theme.fg("muted", "write ") + theme.fg("accent", filePath);
  if (lines > 1) {
    text += theme.fg("dim", ` (${lines} lines)`);
  }
  return text;
}

function fmtEdit(args: Record<string, unknown>, theme: Theme): string {
  const rawPath = (args.file_path || args.path || "...") as string;
  return theme.fg("muted", "edit ") + theme.fg("accent", shortenPath(rawPath));
}

function fmtLs(args: Record<string, unknown>, theme: Theme): string {
  const rawPath = (args.path || ".") as string;
  return theme.fg("muted", "ls ") + theme.fg("accent", shortenPath(rawPath));
}

function fmtFind(args: Record<string, unknown>, theme: Theme): string {
  const pattern = (args.pattern || "*") as string;
  const rawPath = (args.path || ".") as string;
  return (
    theme.fg("muted", "find ") +
    theme.fg("accent", pattern) +
    theme.fg("dim", ` in ${shortenPath(rawPath)}`)
  );
}

function fmtGrep(args: Record<string, unknown>, theme: Theme): string {
  const pattern = (args.pattern || "") as string;
  const rawPath = (args.path || ".") as string;
  return (
    theme.fg("muted", "grep ") +
    theme.fg("accent", `/${pattern}/`) +
    theme.fg("dim", ` in ${shortenPath(rawPath)}`)
  );
}

function fmtEval(args: Record<string, unknown>, theme: Theme): string {
  const lang = (args.language || "js") as string;
  const code = (args.code || "") as string;
  const firstLine = code.split("\n")[0] ?? "";
  const preview = truncate(firstLine, 50);
  return (
    theme.fg("muted", "eval ") +
    theme.fg("accent", lang) +
    (preview ? theme.fg("dim", ` "${preview}"`) : "")
  );
}

function fmtGhSearch(args: Record<string, unknown>, theme: Theme): string {
  const scope = (args.scope || "") as string;
  const query = (args.query || "") as string;
  const preview = truncate(query, 50);
  return (
    theme.fg("muted", "gh_search ") +
    theme.fg("accent", scope) +
    (preview ? theme.fg("dim", ` "${preview}"`) : "")
  );
}

function fmtGhFetch(args: Record<string, unknown>, theme: Theme): string {
  const url = (args.url || "") as string;
  return theme.fg("muted", "gh_fetch ") + theme.fg("accent", shortenPath(url));
}

function fmtWebFetch(args: Record<string, unknown>, theme: Theme): string {
  const url = (args.url || "") as string;
  const preview = truncate(url, 60);
  return theme.fg("muted", "WebFetch ") + theme.fg("accent", preview);
}

function fmtWebSearch(args: Record<string, unknown>, theme: Theme): string {
  const query = (args.query || "") as string;
  const preview = truncate(query, 50);
  return theme.fg("muted", "WebSearch ") + theme.fg("accent", `"${preview}"`);
}

const TOOL_FORMATTERS: Record<string, ToolFormatter> = {
  bash: fmtBash,
  read: fmtRead,
  write: fmtWrite,
  edit: fmtEdit,
  ls: fmtLs,
  find: fmtFind,
  grep: fmtGrep,
  eval: fmtEval,
  gh_search: fmtGhSearch,
  gh_fetch: fmtGhFetch,
  WebFetch: fmtWebFetch,
  WebSearch: fmtWebSearch,
};

/** Format a single tool call for TUI display in expanded results. */
export function formatToolCall(
  name: string,
  args: Record<string, unknown>,
  theme: Theme,
): string {
  const fmt = TOOL_FORMATTERS[name];
  if (fmt) {
    return fmt(args, theme);
  }
  const argsStr = JSON.stringify(args);
  const preview = truncate(argsStr, 50);
  return theme.fg("accent", name) + theme.fg("dim", ` ${preview}`);
}

/** Extract tool call display items from child process messages. */
export function getDisplayItemsFromMessages(
  messages: Message[] | undefined,
): DisplayItem[] {
  if (!messages) {
    return [];
  }
  const items: DisplayItem[] = [];
  for (const msg of messages) {
    if (msg.role !== "assistant") {
      continue;
    }
    for (const part of msg.content) {
      if (
        typeof part === "object" &&
        "type" in part &&
        part.type === "toolCall"
      ) {
        items.push({
          type: "toolCall",
          name: part.name,
          args: part.arguments,
        });
      }
    }
  }
  return items;
}

function isToolCallPart(part: unknown): boolean {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as { type: string }).type === "toolCall"
  );
}

/**
 * Strip child process messages to only tool call metadata needed for TUI
 * rendering. Drops user messages, assistant text content, and all tool
 * result content — preventing writable-tool contents and command output
 * from being duplicated in the parent session JSONL.
 */
export function stripMessagesForPersistence(
  messages: Message[] | undefined,
): Message[] | undefined {
  if (!messages || messages.length === 0) {
    return messages;
  }
  return messages
    .filter((msg) => msg.role === "assistant")
    .map((msg) => ({
      ...msg,
      content: msg.content.filter(isToolCallPart),
    }))
    .filter((msg) => msg.content.length > 0);
}

/** Add per-agent breakdown lines for parallel mode results. */
function renderParallelBreakdown(
  box: Box,
  results: SubagentResult[],
  theme: Theme,
): void {
  box.addChild(new Text("", 0, 0)); // spacer
  for (const r of results) {
    const rIcon =
      r.exitCode !== 0 || r.error
        ? theme.fg("error", "  ✗ ")
        : theme.fg("success", "  ✓ ");
    box.addChild(
      new Text(rIcon + theme.fg("accent", r.agent) + statsLine(r, theme), 0, 0),
    );
    if (r.error) {
      box.addChild(new Text(theme.fg("error", `    ${r.error}`), 0, 0));
    }
  }
}

// ── Shared renderers ────────────────────────────────────────────────────────

function resolveAgentLabel(details: SubagentResult): string {
  if (details.agent !== "parallel") {
    return details.agent;
  }
  return `${details.results?.length ?? 0} agents`;
}

function resolveStatus(
  details: SubagentResult,
  theme: Theme,
): { isError: boolean; statusIcon: string } {
  const isError = details.exitCode !== 0 || !!details.error;
  const statusIcon = isError
    ? theme.fg("error", "✗ ")
    : theme.fg("success", "✓ ");
  return { isError, statusIcon };
}

/**
 * Build the expanded result view for a subagent result.
 * Used by both `subagent` and `subagent_resume` tools.
 */
export function renderExpandedResult(
  details: SubagentResult,
  theme: Theme,
): Box {
  const { isError, statusIcon } = resolveStatus(details, theme);
  const agentLabel = resolveAgentLabel(details);
  const output = details.output || "(no output)";

  const box = new Box(0, 0);

  // Header line
  box.addChild(
    new Text(
      statusIcon + theme.fg("accent", agentLabel) + statsLine(details, theme),
      0,
      0,
    ),
  );

  // Tool calls (from child process messages)
  const displayItems = getDisplayItemsFromMessages(details.messages);
  if (displayItems.length > 0) {
    box.addChild(new Text(theme.fg("muted", "─── Tool calls ───"), 0, 0));
    for (const item of displayItems) {
      box.addChild(
        new Text(
          theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme),
          0,
          0,
        ),
      );
    }
    box.addChild(new Text("", 0, 0)); // spacer before output
  }

  // Output body
  box.addChild(
    new Text(
      isError ? theme.fg("error", output) : theme.fg("text", output),
      0,
      0,
    ),
  );

  // Per-agent breakdown for parallel mode
  if (details.results && details.results.length > 0) {
    renderParallelBreakdown(box, details.results, theme);
  }

  // Stats footer
  box.addChild(
    new Text(theme.fg("muted", expandedStats(details, theme)), 0, 0),
  );

  return box;
}

/**
 * Build the collapsed result view for a subagent result.
 *
 * Uses BgSafeTruncatedText for the first line (width-aware truncation).
 * When output exceeds PREVIEW_LINES or is an error, wraps in a Box with
 * a second line for the expand hint since TruncatedText is single-line.
 */
export function renderCollapsedResult(
  details: SubagentResult,
  theme: Theme,
): Component {
  const isError = details.exitCode !== 0 || !!details.error;
  const statusIcon = isError
    ? theme.fg("error", "✗ ")
    : theme.fg("success", "✓ ");
  const agentLabel =
    details.agent !== "parallel"
      ? details.agent
      : `${details.results?.length ?? 0} agents`;
  const output = details.output || "(no output)";
  const firstLine = output.split("\n")[0] ?? "";
  const totalLines = countLines(output);

  const truncatedFirstLine =
    firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
  const firstLineDisplay = isError
    ? theme.fg("error", truncatedFirstLine)
    : theme.fg("text", truncatedFirstLine);

  const collapsedLine =
    statusIcon +
    theme.fg("accent", `${agentLabel}`) +
    statsLine(details, theme) +
    theme.fg("muted", "  ") +
    firstLineDisplay;

  const needsHint = totalLines > PREVIEW_LINES || isError;

  if (!needsHint) {
    return new BgSafeTruncatedText(collapsedLine, 0, 0);
  }

  // Box: truncated first line + hint on second line
  const remaining = Math.max(0, totalLines - PREVIEW_LINES);
  const box = new Box(0, 0);
  box.addChild(new BgSafeTruncatedText(collapsedLine, 0, 0));
  box.addChild(
    new Text(
      remaining > 0 ? getExpandHint(theme, remaining) : getExpandHint(theme),
      0,
      0,
    ),
  );
  return box;
}

/**
 * Build the "running" state for a subagent result.
 * Shows live tool calls from child process messages as they stream in.
 */
export function renderRunningState(
  details: SubagentResult | undefined,
  theme: Theme,
): Component {
  if (!details) {
    return new Text(theme.fg("muted", "running..."), 0, 0);
  }
  const agentLabel =
    details.agent !== "parallel"
      ? details.agent
      : `${details.results?.length ?? 0} agents`;

  const items = getDisplayItemsFromMessages(details.messages);
  const box = new Box(0, 0);

  // Header: agent + stats + running indicator
  box.addChild(
    new Text(
      theme.fg("muted", "⏳ ") +
        theme.fg("accent", agentLabel) +
        statsLine(details, theme) +
        theme.fg("muted", " (running...)"),
      0,
      0,
    ),
  );

  // Show recent tool calls (last 5)
  const recentItems = items.slice(-5);
  for (const item of recentItems) {
    box.addChild(
      new Text(
        theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme),
        0,
        0,
      ),
    );
  }

  // If output is available, show first line
  if (details.output) {
    const firstLine = details.output.split("\n")[0] ?? "";
    const preview =
      firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
    if (preview) {
      box.addChild(new Text(theme.fg("text", preview), 0, 0));
    }
  }

  return box;
}

// =============================================================================
// Shared renderResult for subagent + resume tools
// =============================================================================

/**
 * Shared {@link ToolDefinition.renderResult} for subagent tools.
 * Both `subagent` and `subagent_resume` delegate here to avoid duplication.
 */
export function renderSubagentToolResult(
  result: {
    content: Array<{ type: string; text?: string }>;
    details: SubagentResult | undefined;
  },
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
  context: { isError: boolean },
): Component {
  const details = result.details as SubagentResult | undefined;

  if (options.isPartial && !context.isError) {
    return renderRunningState(details, theme);
  }

  if (!details) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  if (options.expanded) {
    return renderExpandedResult(details, theme);
  }

  return renderCollapsedResult(details, theme);
}
