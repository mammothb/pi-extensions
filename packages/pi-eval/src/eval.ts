import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { extractTextContent, getExpandKey } from "@mammothb/pi-shared";
import { Type } from "typebox";
import { loadConfig } from "./lib/config.js";
import { executeJavaScript } from "./lib/javascript.js";
import { executePython } from "./lib/python.js";
import {
  EvalCancelledError,
  EvalCwdNotFoundError,
  type EvalDetails,
  EvalUnsupportedLanguageError,
} from "./lib/types.js";

export const TIMEOUT_MS = 30_000;

const Parameters = Type.Object({
  language: Type.Union([Type.Literal("javascript"), Type.Literal("python")]),
  code: Type.String({ description: "Code to execute" }),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the subprocess (default: agent's cwd)",
    }),
  ),
});

const PREVIEW_LINES = 5;

interface ParsedOutput {
  stdout: string;
  stderr: string;
  truncated: boolean;
  signal: string | null;
}

/** Parse the STDOUT/STDERR formatted output text back into sections. */
function parseOutput(text: string): ParsedOutput {
  const truncated = text.includes("[Output truncated at 1 MB]");
  const signalMatch = text.match(/\[Process killed by signal: ([^\]]+)\]/);
  const signal = signalMatch ? (signalMatch[1] ?? null) : null;

  const stdoutMatch = text.match(
    /^STDOUT:\n([\s\S]*?)(?:\n\nSTDERR:|\n\n\[|$)/,
  );
  const stderrMatch = text.match(/STDERR:\n([\s\S]*?)(?:\n\n\[|$)/);

  const stdout = stdoutMatch ? (stdoutMatch[1] ?? "") : "";
  const stderr = stderrMatch ? (stderrMatch[1] ?? "") : "";

  return { stdout, stderr, truncated, signal };
}

/** Count all lines in a string (including empty lines). */
function countLines(s: string): number {
  if (!s || s.length === 0) {
    return 0;
  }
  return s.split("\n").length;
}

/** Get first N non-empty (non-whitespace-only) lines from a string. */
function firstNonEmptyLines(s: string, n: number): string[] {
  return s
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, n);
}

/**
 * Build a stats header line.
 * Format: `exit 0 | 3 lines | truncated | Ctrl+O to expand`
 */
function buildStatsLine(
  details: EvalDetails | undefined,
  rawText: string,
  isError: boolean,
  parsed: ParsedOutput,
  totalLines: number,
  theme: Theme,
  expandKey: string,
  showExpandHint: boolean,
): string {
  const statusColor = isError ? "error" : "success";
  const parts: string[] = [];

  // Status: exit code or signal or error message
  if (parsed.signal) {
    parts.push(theme.fg(statusColor, `killed by ${parsed.signal}`));
  } else if (details?.exitCode != null) {
    parts.push(theme.fg(statusColor, `exit ${details.exitCode}`));
  } else if (isError) {
    // Error path where details are unavailable: show first line of error text
    const firstLine = rawText.split("\n")[0] ?? "error";
    parts.push(theme.fg(statusColor, firstLine));
  } else {
    parts.push(theme.fg(statusColor, "exit 0"));
  }

  // Line count
  if (totalLines > 0) {
    parts.push(theme.fg("muted", `| ${totalLines} lines`));
  } else {
    parts.push(theme.fg("muted", "| no output"));
  }

  // Truncation notice
  if (parsed.truncated) {
    parts.push(theme.fg("warning", "| truncated"));
  }

  // Expand hint (collapsed only, when there are lines)
  if (showExpandHint && totalLines > 0) {
    parts.push(theme.fg("muted", `| ${expandKey} to expand`));
  }

  return parts.join(" ");
}

export function createEvalTool(): ToolDefinition<
  typeof Parameters,
  EvalDetails
> {
  return {
    name: "eval",
    label: "Eval",
    description: `Execute JavaScript or Python code in an isolated subprocess.

- Each call is a fresh subprocess — no state persists between calls
- 30-second timeout; press Escape to cancel a running evaluation
- Working directory is the agent's current working directory (like bash)
- Set cwd to specify a working directory for the subprocess (default: agent's cwd)
- Set pythonPath or nodeModulesPath in ~/.pi/agent/pi-eval.json (global) or .pi/pi-eval.json (project) to configure the runtime for all eval calls`,
    promptSnippet:
      "Execute JavaScript or Python code in an isolated subprocess",
    parameters: Parameters,
    renderCall(args, theme, ctx) {
      const badge = args.language === "javascript" ? "(js)" : "(py)";
      const badgeColored = theme.fg("syntaxKeyword", badge);

      let preview: string;
      if (!args.code || args.code.trim().length === 0) {
        preview = theme.fg("toolOutput", "(no code)");
      } else {
        const firstLine = args.code.split("\n")[0] ?? "";
        const isMultiLine = args.code.includes("\n");
        const truncated = firstLine.length > 65;
        const display = truncated ? firstLine.slice(0, 65) : firstLine;
        const suffix = truncated || isMultiLine ? "..." : "";
        preview = theme.fg("toolOutput", display + suffix);
      }

      // Show cwd hint when it differs from the agent's cwd
      let cwdHint = "";
      if (args.cwd != null && args.cwd !== ctx.cwd) {
        cwdHint = theme.fg("muted", ` (cwd: ${args.cwd})`);
      }

      const text =
        ctx.lastComponent instanceof Text
          ? ctx.lastComponent
          : new Text("", 0, 0);
      text.setText(
        theme.fg("toolTitle", theme.bold("eval")) +
          " " +
          badgeColored +
          "  " +
          preview +
          cwdHint,
      );
      return text;
    },
    renderResult(result, options, theme, ctx) {
      // Phase 5: Running state
      if (options.isPartial && !ctx.isError) {
        return new Text(theme.fg("muted", "evaluating..."), 0, 0);
      }

      const details = result.details as EvalDetails | undefined;
      const rawText = extractTextContent(result);

      const parsed = parseOutput(rawText);
      const isError =
        ctx.isError ||
        (details?.exitCode != null && details.exitCode !== 0) ||
        details?.exitSignal != null;
      const expandKey = getExpandKey();

      // Determine which output stream to preview
      let previewSource: string;
      if (isError) {
        previewSource = (parsed.stderr || parsed.stdout || "").trim();
      } else {
        previewSource = (parsed.stdout || "").trim();
      }

      const totalLines = countLines(previewSource);

      // Phase 4: Expanded view — show raw text with stats header
      if (options.expanded) {
        const header = buildStatsLine(
          details,
          rawText,
          isError,
          parsed,
          totalLines,
          theme,
          expandKey,
          false, // no expand hint in expanded mode
        );
        return new Text(`${header}\n${rawText}`, 0, 0);
      }

      // No output at all — just stats header, no Ctrl+O
      if (!previewSource || totalLines === 0) {
        const header = buildStatsLine(
          details,
          rawText,
          isError,
          parsed,
          0,
          theme,
          expandKey,
          false,
        );
        return new Text(header, 0, 0);
      }

      // Collapsed view with output
      const previewLines = firstNonEmptyLines(previewSource, PREVIEW_LINES);
      const allNonEmptyCount = firstNonEmptyLines(
        previewSource,
        Number.MAX_SAFE_INTEGER,
      ).length;
      const remaining = Math.max(0, allNonEmptyCount - previewLines.length);

      // Expand hint in header only when there are hidden lines (remaining > 0)
      // or when it's an error (errors always get the hint in the header)
      const showHintInHeader = isError || remaining > 0;

      // Stats header
      const statsHeader = buildStatsLine(
        details,
        rawText,
        isError,
        parsed,
        totalLines,
        theme,
        expandKey,
        showHintInHeader,
      );

      // Build result as a single Text (avoids Container/Box padding issues)
      const parts: string[] = [statsHeader];

      if (previewLines.length > 0) {
        parts.push(previewLines.join("\n"));
      }

      if (remaining > 0) {
        parts.push(
          theme.fg("muted", `... (${remaining} more lines, `) +
            theme.fg("muted", expandKey) +
            theme.fg("muted", " to expand)"),
        );
      } else if (previewLines.length > 0 && !showHintInHeader) {
        parts.push(theme.fg("muted", `  ${expandKey} to expand`));
      }

      return new Text(parts.join("\n"), 0, 0);
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { language, code, cwd: paramsCwd } = params;

      // Resolve and validate the working directory
      let effectiveCwd: string;
      if (paramsCwd != null) {
        const resolved = isAbsolute(paramsCwd)
          ? paramsCwd
          : resolve(ctx.cwd, paramsCwd);
        try {
          const s = await stat(resolved);
          if (!s.isDirectory()) {
            throw new EvalCwdNotFoundError(resolved, "not a directory");
          }
        } catch (err) {
          if (err instanceof EvalCwdNotFoundError) {
            throw err;
          }
          throw new EvalCwdNotFoundError(resolved);
        }
        effectiveCwd = resolved;
      } else {
        effectiveCwd = ctx.cwd;
      }

      const config = loadConfig(effectiveCwd);

      // Validate language (belt-and-suspenders: TypeBox schema already constrains it,
      // but a raw API call could bypass validation)
      if (language !== "javascript" && language !== "python") {
        throw new EvalUnsupportedLanguageError(language);
      }

      if (signal?.aborted) {
        throw new EvalCancelledError();
      }

      // Build timeout signal — passed separately from the user signal so
      // subprocess.ts can discriminate timeout vs user cancel
      const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);

      if (timeoutSignal.aborted) {
        throw new EvalCancelledError();
      }

      // Trigger running state so renderResult shows "evaluating..."
      onUpdate?.({
        content: [{ type: "text", text: "" }],
        details: { language, exitCode: null, exitSignal: null },
      });

      if (language === "python") {
        return executePython(
          code,
          config.pythonPath,
          signal,
          timeoutSignal,
          effectiveCwd,
        );
      }

      // ── JavaScript execution via temp file + node subprocess ──
      return executeJavaScript(
        code,
        config.nodeModulesPath,
        signal,
        timeoutSignal,
        effectiveCwd,
      );
    },
  };
}
