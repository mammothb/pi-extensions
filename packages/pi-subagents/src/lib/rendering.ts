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
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") {
      count++;
    }
  }
  return count;
}

// ── Shared renderers ────────────────────────────────────────────────────────

/**
 * Build the expanded result view for a subagent result.
 * Used by both `subagent` and `subagent_resume` tools.
 */
export function renderExpandedResult(
  details: SubagentResult,
  theme: Theme,
): Box {
  const isError = details.exitCode !== 0 || !!details.error;
  const statusIcon = isError
    ? theme.fg("error", "✗ ")
    : theme.fg("success", "✓ ");
  const agentLabel =
    details.agent !== "parallel"
      ? details.agent
      : `${details.results?.length ?? 0} agents`;
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
    box.addChild(new Text("", 0, 0)); // spacer
    for (const r of details.results) {
      const rIcon =
        r.exitCode !== 0 || r.error
          ? theme.fg("error", "  ✗ ")
          : theme.fg("success", "  ✓ ");
      box.addChild(
        new Text(
          rIcon + theme.fg("accent", r.agent) + statsLine(r, theme),
          0,
          0,
        ),
      );
      if (r.error) {
        box.addChild(new Text(theme.fg("error", `    ${r.error}`), 0, 0));
      }
    }
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

  const collapsedLine =
    statusIcon +
    theme.fg("accent", `${agentLabel}`) +
    statsLine(details, theme) +
    theme.fg("muted", "  ") +
    (isError
      ? theme.fg(
          "error",
          firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine,
        )
      : theme.fg("text", firstLine));

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
 * Build the "running" state line for a subagent result.
 */
export function renderRunningState(
  details: SubagentResult | undefined,
  theme: Theme,
): Text {
  if (!details) {
    return new Text(theme.fg("muted", "running..."), 0, 0);
  }
  const agentLabel =
    details.agent !== "parallel"
      ? details.agent
      : `${details.results?.length ?? 0} agents`;
  return new Text(
    theme.fg("muted", "⏳ ") +
      theme.fg("accent", agentLabel) +
      statsLine(details, theme) +
      theme.fg("muted", " (running...)"),
    0,
    0,
  );
}
