import { execFileSync } from "node:child_process";
import type { Message } from "@earendil-works/pi-ai";

// ── CompileInput ──

interface CompileInput {
  messages: Message[];
  previousSummary?: string;
}

// ── PiRequest / PiResponse (protocol with mm-cli) ──

interface PiRequest {
  messages: Message[];
  previousSummary?: string;
}

interface PiResponse {
  summary: string;
  stats: {
    messagesIn: number;
    blocksOut: number;
    toolCalls: number;
    toolResults: number;
    tokenCount: number;
  };
}

// ── Binary discovery ──

/** Resolve the path to the `mm` binary. */
const findMmBinary = (): string => {
  if (process.env.MM_CLI_PATH) {
    return process.env.MM_CLI_PATH;
  }

  // Try `which mm` first (cross-platform)
  try {
    const result = execFileSync("which", ["mm"], { encoding: "utf-8" });
    const found = result.trim();
    if (found) {
      return found;
    }
  } catch {
    // which not found or mm not on PATH — fall through
  }

  throw new Error(
    "mm not found. Install with: cargo install mm-cli\n" +
      "Or set MM_CLI_PATH to the mm binary location.",
  );
};

// ── Word wrapping ──

const TUI_SAFE_LINE_CHARS = 120;

const wrapLine = (line: string, maxChars: number): string[] => {
  if (line.length <= maxChars) {
    return [line];
  }

  const indent = line.match(/^\s*(?:[-*]\s+|\d+\.\s+)?/)?.[0] ?? "";
  const continuationIndent = indent
    ? " ".repeat(Math.min(indent.length, 8))
    : "";
  const wrapped: string[] = [];
  let remaining = line;
  let prefix = "";

  while (prefix.length + remaining.length > maxChars) {
    const available = Math.max(20, maxChars - prefix.length);
    let splitAt = remaining.lastIndexOf(" ", available);
    if (splitAt < Math.floor(available * 0.5)) {
      splitAt = available;
    }

    wrapped.push(prefix + remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
    prefix = continuationIndent;
  }

  if (remaining) {
    wrapped.push(prefix + remaining);
  }
  return wrapped;
};

const wrapLongLines = (text: string, maxChars = TUI_SAFE_LINE_CHARS): string =>
  text
    .split("\n")
    .flatMap((line) => wrapLine(line, maxChars))
    .join("\n");

// ── RECALL_NOTE ──

/** Appended once to the final summary so it doesn't compound across compactions.
 *  Must match the string stripped in merge.rs. */
const RECALL_NOTE =
  "Use `mm_recall` to search for prior work, decisions, and context from before this summary. Do not redo work already completed.";

/** Strip RECALL_NOTE from a previous summary so it doesn't compound. */
const stripRecallNote = (text: string): string => {
  const idx = text.lastIndexOf(RECALL_NOTE);
  if (idx < 0) {
    return text;
  }
  return text
    .slice(0, idx)
    .replace(/\s*(?:\n\n---\n\n)?\s*$/, "")
    .trimEnd();
};

// ── Compile ──

const SECTION_SEPARATOR = "\n\n---\n\n";

/**
 * Compile a compaction summary by delegating to the `mm pi` subprocess.
 *
 * All heavy computation (normalize, filter noise, section extraction, brief
 * compilation, merge with previous summary) is handled by mm-cli. The shim
 * only wraps the subprocess call and appends the RECALL_NOTE.
 */
export const compile = (input: CompileInput): string => {
  const mmBin = findMmBinary();

  const request: PiRequest = {
    messages: input.messages,
    previousSummary: input.previousSummary
      ? stripRecallNote(input.previousSummary)
      : undefined,
  };

  const stdin = JSON.stringify(request);
  let stdout: string;
  try {
    stdout = execFileSync(mmBin, ["pi"], {
      input: stdin,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50 MB — large sessions
      timeout: 60_000,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`mm pi subprocess failed: ${message}`);
  }

  let response: PiResponse;
  try {
    response = JSON.parse(stdout) as PiResponse;
  } catch {
    throw new Error(`Failed to parse mm pi output: ${stdout.slice(0, 200)}`);
  }

  const merged = response.summary;
  if (!merged) {
    return "";
  }

  return wrapLongLines(merged + SECTION_SEPARATOR + RECALL_NOTE);
};
