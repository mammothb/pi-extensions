import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import type { Message } from "@earendil-works/pi-ai";
import { wrapWithBubblewrap } from "./sandbox.js";
import { generateChildSessionFile, seedForkSession } from "./session.js";
import type { AgentConfig, SubagentResult } from "./types.js";

/**
 * Determine how to invoke the `pi` binary.
 *
 * Logic mirrors the official pi subagent example:
 * - If the current script path exists on disk, use it (development mode).
 * - If the current runtime is not a generic node/bun binary, use it directly.
 * - Otherwise, fall back to `pi` on PATH.
 */
export function getPiInvocation(args: string[]): {
  command: string;
  args: string[];
} {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");

  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

/**
 * Spawn a child process. Low-level wrapper around node:child_process spawn
 * with stdio configured for JSONL stream parsing.
 */
export function spawnChild(
  command: string,
  args: string[],
  cwd: string,
): ChildProcess {
  return spawn(command, args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Spawn a child `pi` process with the given CLI args.
 * Uses getPiInvocation to determine the correct command and prepend the
 * current script path in development mode.
 */
// =============================================================================
// JSONL parsing
// =============================================================================

export interface CumulativeResult {
  messages: Message[];
  usage: SubagentResult["tokens"] & { turns: number };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  finalOutput: string;
}

function emptyCumulativeResult(): CumulativeResult {
  return {
    messages: [],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      turns: 0,
    },
    finalOutput: "",
  };
}

function extractFinalOutput(messages: Message[]): string {
  // Find last assistant message
  let lastAssistant: Message | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistant = messages[i];
      break;
    }
  }
  if (!lastAssistant) {
    return "";
  }

  // Concatenate all text parts in order
  const parts: string[] = [];
  for (const part of lastAssistant.content) {
    if (typeof part === "object" && "type" in part && part.type === "text") {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("");
}

/**
 * Parse a JSONL stream from a child pi process stdout.
 *
 * Handles:
 * - `message_end` events: push message, accumulate usage/turns
 * - `tool_result_end` events: push message
 * - Partial line buffering (chunks may split mid-line)
 * - Malformed JSON lines (warn and skip)
 *
 * Calls `onUpdate` after each recognized event so callers can stream progress.
 * Resolves with the final CumulativeResult when the stream ends.
 */
function processJsonlLine(
  line: string,
  result: CumulativeResult,
  onUpdate: ((result: CumulativeResult) => void) | undefined,
): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let event: { type: string; message?: unknown };
  try {
    event = JSON.parse(trimmed);
  } catch {
    console.warn("parseJsonlStream: skipping malformed JSON line");
    return;
  }

  if (
    (event.type !== "message_end" && event.type !== "tool_result_end") ||
    !event.message
  ) {
    return;
  }

  const msg = event.message as Message;
  result.messages.push(msg);

  if (event.type === "message_end" && msg.role === "assistant") {
    result.usage.turns++;
    const usage = msg.usage;
    if (usage) {
      result.usage.input += usage.input ?? 0;
      result.usage.output += usage.output ?? 0;
      result.usage.cacheRead += usage.cacheRead ?? 0;
      result.usage.cacheWrite += usage.cacheWrite ?? 0;
      result.usage.total += usage.totalTokens ?? 0;
    }
    if (!result.model && msg.model) {
      result.model = msg.model;
    }
    if (msg.stopReason) {
      result.stopReason = msg.stopReason;
    }
    if (msg.errorMessage) {
      result.errorMessage = msg.errorMessage;
    }
  }

  result.finalOutput = extractFinalOutput(result.messages);
  onUpdate?.(result);
}

export function parseJsonlStream(
  stream: Readable,
  onUpdate: ((result: CumulativeResult) => void) | undefined,
): Promise<CumulativeResult> {
  const result = emptyCumulativeResult();
  let buffer = "";

  return new Promise<CumulativeResult>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processJsonlLine(line, result, onUpdate);
      }
    });

    stream.on("end", () => {
      if (buffer.trim()) {
        processJsonlLine(buffer, result, onUpdate);
      }
      resolve(result);
    });

    stream.on("error", (err) => {
      reject(err); // NOSONAR — err is Error from stream
    });
  });
}

// =============================================================================
// Launch integration
// =============================================================================

/**
 * Launch a child pi subagent, parse its JSONL output, and return the result.
 *
 * Builds CLI args from agent config, resolves pi invocation, then delegates
 * to launchChild for process management.
 *
 * When agent.mode is "fork" and parentSessionFile is provided, a child
 * session file is seeded with the parent's transcript before launch.
 * The child session is cleaned up after exit unless noSession is false.
 */
export async function launchSubagent(
  agent: AgentConfig,
  task: string,
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((result: SubagentResult) => void) | undefined,
  stuckTimeoutMs: number,
  parentSessionFile?: string,
): Promise<SubagentResult> {
  let forkFile: string | undefined;

  if (agent.mode === "fork" && parentSessionFile) {
    forkFile = generateChildSessionFile();
    try {
      seedForkSession(parentSessionFile, forkFile, agent, cwd);
    } catch (err) {
      console.warn(
        `[pi-subagents] agent "${agent.name}" failed to seed fork session, falling back to clean: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        rmSync(forkFile, { force: true });
      } catch {
        // Best-effort cleanup
      }
      forkFile = undefined;
    }
  } else if (agent.mode === "fork" && !parentSessionFile) {
    console.warn(
      `[pi-subagents] agent "${agent.name}" has mode=fork but parent has no session file. Falling back to clean.`,
    );
  }

  const args = buildCliArgs(agent, task, forkFile);
  try {
    const result = await launchPiChild(
      args,
      agent,
      task,
      cwd,
      signal,
      onUpdate,
      stuckTimeoutMs,
    );
    if (forkFile && !agent.noSession) {
      result.sessionFile = forkFile;
    }
    return result;
  } finally {
    if (forkFile && agent.noSession) {
      try {
        rmSync(forkFile, { force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

/**
 * Spawn a child pi process with pre-built CLI args. Exported for callers that
 * already have args (e.g. resume).
 */
export async function launchPiChild(
  piArgs: string[],
  agent: AgentConfig,
  task: string,
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((result: SubagentResult) => void) | undefined,
  stuckTimeoutMs: number,
): Promise<SubagentResult> {
  const invocation = getPiInvocation(piArgs);
  return launchChild({
    command: invocation.command,
    args: invocation.args,
    agent,
    task,
    cwd,
    signal,
    onUpdate,
    stuckTimeoutMs,
  });
}

function createOnUpdateWrapper(
  onUpdate: ((result: SubagentResult) => void) | undefined,
  agent: AgentConfig,
  task: string,
  startedAt: number,
  tracker: {
    lastActivity: number;
    stuckWarned: boolean;
    lastUsage: SubagentResult["tokens"];
    lastActivityDesc: string;
  },
): ((cumulative: CumulativeResult) => void) | undefined {
  if (!onUpdate) {
    return undefined;
  }
  return (cumulative: CumulativeResult) => {
    tracker.lastActivity = Date.now();
    tracker.stuckWarned = false;
    tracker.lastUsage = { ...cumulative.usage };
    const lastMsg = cumulative.messages[cumulative.messages.length - 1];
    if (lastMsg) {
      if (lastMsg.role === "toolResult") {
        tracker.lastActivityDesc = `tool:${lastMsg.toolName}`;
      } else if (lastMsg.role === "assistant") {
        tracker.lastActivityDesc = "assistant message";
      }
    }
    onUpdate({
      agent: agent.name,
      task,
      output: cumulative.finalOutput || "(running...)",
      exitCode: -1,
      elapsed: Date.now() - startedAt,
      tokens: { ...cumulative.usage },
      model: cumulative.model,
    });
  };
}

function setupAbortHandlers(
  signal: AbortSignal | undefined,
  proc: ReturnType<typeof spawnChild>,
): { wasAborted: () => boolean; cleanup: () => void } {
  let wasAborted = false;
  let sigkillTimer: ReturnType<typeof setTimeout> | undefined;

  if (!signal) {
    return { wasAborted: () => false, cleanup: () => {} };
  }

  const killProc = () => {
    wasAborted = true;
    proc.kill("SIGTERM");
    sigkillTimer = setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
      sigkillTimer = undefined;
    }, 5000);
  };

  if (signal.aborted) {
    killProc();
    return {
      wasAborted: () => true,
      cleanup: () => {
        if (sigkillTimer) {
          clearTimeout(sigkillTimer);
        }
      },
    };
  }

  signal.addEventListener("abort", killProc, { once: true });
  return {
    wasAborted: () => wasAborted,
    cleanup: () => {
      signal.removeEventListener("abort", killProc);
      if (sigkillTimer) {
        clearTimeout(sigkillTimer);
      }
    },
  };
}

function buildSubagentError(
  exitCode: number,
  stderr: string,
  cumulative: CumulativeResult,
  spawnError: string | undefined,
): string | undefined {
  if (exitCode === 0) {
    return cumulative.errorMessage || spawnError;
  }
  const stopMsg =
    cumulative.stopReason &&
    cumulative.stopReason !== "stop" &&
    cumulative.stopReason !== "end"
      ? cumulative.stopReason
      : undefined;
  const inner = stderr.trim() || stopMsg || `exit code ${exitCode}`;
  return cumulative.errorMessage || spawnError || inner;
}

/**
 * Launch a child process with given command + args, parse JSONL stdout,
 * apply stuck detection and abort handling. Exported for testing with
 * arbitrary commands (e.g. node scripts that simulate pi JSONL output).
 */
export async function launchChild(opts: {
  command: string;
  args: string[];
  agent: AgentConfig;
  task: string;
  cwd: string;
  signal?: AbortSignal;
  onUpdate?: (result: SubagentResult) => void;
  stuckTimeoutMs: number;
}): Promise<SubagentResult> {
  const { command, args, agent, task, cwd, signal, onUpdate, stuckTimeoutMs } =
    opts;
  const startedAt = Date.now();

  // Wrap in bubblewrap sandbox when agent requests isolation
  let resolvedCmd = command;
  let resolvedArgs = args;
  if (opts.agent.sandbox) {
    const wrapped = wrapWithBubblewrap(resolvedCmd, resolvedArgs);
    resolvedCmd = wrapped.command;
    resolvedArgs = wrapped.args;
  }

  const proc = spawnChild(resolvedCmd, resolvedArgs, cwd);

  let stderr = "";
  proc.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  // Stuck detection heartbeat
  const tracker = {
    lastActivity: Date.now(),
    lastActivityDesc: "starting",
    lastUsage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      turns: 0,
    } as SubagentResult["tokens"],
    stuckWarned: false,
  };
  let stuckTimer: ReturnType<typeof setInterval> | undefined;

  if (stuckTimeoutMs > 0) {
    stuckTimer = setInterval(() => {
      const idleMs = Date.now() - tracker.lastActivity;
      if (idleMs > stuckTimeoutMs && !tracker.stuckWarned) {
        tracker.stuckWarned = true;
        onUpdate?.({
          agent: agent.name,
          task,
          output: `⚠️ No progress for ${Math.round(idleMs / 1000)}s. Last activity: ${tracker.lastActivityDesc}. Ctrl+C to abort, or wait — the model may be thinking.`,
          exitCode: -1,
          elapsed: Date.now() - startedAt,
          tokens: { ...tracker.lastUsage },
        });
      }
    }, 5000);
  }

  const wrappedOnUpdate = createOnUpdateWrapper(
    onUpdate,
    agent,
    task,
    startedAt,
    tracker,
  );

  // Abort signal handling
  const { wasAborted, cleanup: abortCleanup } = setupAbortHandlers(
    signal,
    proc,
  );

  // Capture exit code — set up before parsing to avoid race
  let spawnError: string | undefined;
  const exitCodePromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 0));
    proc.on("error", (err) => {
      spawnError = err.message;
      resolve(1);
    });
  });

  // Parse JSONL stdout (resolves when stdout stream ends)
  let cumulative: CumulativeResult;
  if (!proc.stdout) {
    cumulative = emptyCumulativeResult();
    cumulative.errorMessage = "child process has no stdout";
  } else {
    try {
      cumulative = await parseJsonlStream(proc.stdout, wrappedOnUpdate);
    } catch (err) {
      cumulative = emptyCumulativeResult();
      cumulative.errorMessage =
        err instanceof Error ? err.message : String(err);
    }
  }

  const exitCode = await exitCodePromise;

  // Cleanup
  if (stuckTimer) {
    clearInterval(stuckTimer);
  }
  abortCleanup();

  const elapsed = Date.now() - startedAt;

  if (wasAborted()) {
    return {
      agent: agent.name,
      task,
      output: cumulative.finalOutput,
      exitCode,
      elapsed,
      tokens: cumulative.usage,
      model: cumulative.model,
      error: "Subagent was aborted",
    };
  }

  return {
    agent: agent.name,
    task,
    output: cumulative.finalOutput,
    exitCode,
    elapsed,
    tokens: cumulative.usage,
    model: cumulative.model,
    error: buildSubagentError(exitCode, stderr, cumulative, spawnError),
  };
}

// =============================================================================
// CLI arg construction
// =============================================================================

/**
 * Build CLI arguments for a child `pi -p` invocation from an agent config.
 * Returns an array suitable for `spawn("pi", args)`.
 *
 * When `sessionFile` is provided (fork or resume), `--session <path>` is
 * added and `--no-session` is omitted regardless of `agent.noSession`.
 * The session file flag appears early so Pi's CLI parser sees it first.
 */
export function buildCliArgs(
  agent: AgentConfig,
  task: string,
  sessionFile?: string,
): string[] {
  const args = ["-p", "--mode", "json"];

  if (sessionFile) {
    args.push("--session", sessionFile);
  } else if (agent.noSession) {
    args.push("--no-session");
  }

  if (agent.model) {
    args.push("--model", agent.model);
  }

  if (agent.thinking) {
    args.push("--thinking", agent.thinking);
  }

  if (agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  args.push("--", task);
  return args;
}
