import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import type { Message } from "@earendil-works/pi-ai";
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
export function spawnPiChild(args: string[], cwd: string): ChildProcess {
  const invocation = getPiInvocation(args);
  return spawnChild(invocation.command, invocation.args, cwd);
}

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
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") {
      continue;
    }
    for (const part of msg.content) {
      if (typeof part === "object" && "type" in part && part.type === "text") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
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
export function parseJsonlStream(
  stream: Readable,
  onUpdate: ((result: CumulativeResult) => void) | undefined,
): Promise<CumulativeResult> {
  const result = emptyCumulativeResult();
  let buffer = "";

  return new Promise<CumulativeResult>((resolve, reject) => {
    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let event: { type: string; message?: unknown };
      try {
        event = JSON.parse(trimmed);
      } catch {
        console.warn(`parseJsonlStream: skipping malformed JSON line`);
        return;
      }

      if (
        (event.type === "message_end" || event.type === "tool_result_end") &&
        event.message
      ) {
        const msg = event.message as Message;
        result.messages.push(msg);

        if (event.type === "message_end" && msg.role === "assistant") {
          result.usage.turns++;
          const usage = msg.usage;
          if (usage) {
            result.usage.input += usage.input || 0;
            result.usage.output += usage.output || 0;
            result.usage.cacheRead += usage.cacheRead || 0;
            result.usage.cacheWrite += usage.cacheWrite || 0;
            result.usage.total += usage.totalTokens || 0;
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
    };

    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
      }
    });

    stream.on("end", () => {
      if (buffer.trim()) {
        processLine(buffer);
      }
      resolve(result);
    });

    stream.on("error", (err) => {
      reject(err);
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
 */
export async function launchSubagent(
  agent: AgentConfig,
  task: string,
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((result: SubagentResult) => void) | undefined,
  stuckTimeoutMs: number,
): Promise<SubagentResult> {
  const args = buildCliArgs(agent, task);
  const invocation = getPiInvocation(args);
  return launchChild(
    invocation.command,
    invocation.args,
    agent,
    task,
    cwd,
    signal,
    onUpdate,
    stuckTimeoutMs,
  );
}

/**
 * Launch a child process with given command + args, parse JSONL stdout,
 * apply stuck detection and abort handling. Exported for testing with
 * arbitrary commands (e.g. node scripts that simulate pi JSONL output).
 */
export async function launchChild(
  command: string,
  args: string[],
  agent: AgentConfig,
  task: string,
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((result: SubagentResult) => void) | undefined,
  stuckTimeoutMs: number,
): Promise<SubagentResult> {
  const startedAt = Date.now();
  const proc = spawnChild(command, args, cwd);

  let stderr = "";
  proc.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
  });

  // Stuck detection heartbeat
  let lastActivity = Date.now();
  let lastActivityDesc = "starting";
  let stuckTimer: ReturnType<typeof setInterval> | undefined;

  if (stuckTimeoutMs > 0) {
    stuckTimer = setInterval(() => {
      const idleMs = Date.now() - lastActivity;
      if (idleMs > stuckTimeoutMs) {
        onUpdate?.({
          agent: agent.name,
          task,
          output: `⚠️ No progress for ${Math.round(idleMs / 1000)}s. Last activity: ${lastActivityDesc}. Ctrl+C to abort, or wait — the model may be thinking.`,
          exitCode: -1,
          elapsed: Date.now() - startedAt,
          tokens: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
            turns: 0,
          },
        });
      }
    }, 5000);
  }

  // Wrap onUpdate to track activity for stuck detection
  const wrappedOnUpdate = onUpdate
    ? (cumulative: CumulativeResult) => {
        lastActivity = Date.now();
        const lastMsg = cumulative.messages[cumulative.messages.length - 1];
        if (lastMsg) {
          if (lastMsg.role === "toolResult") {
            lastActivityDesc = `tool:${lastMsg.toolName}`;
          } else if (lastMsg.role === "assistant") {
            lastActivityDesc = "assistant message";
          }
        }

        onUpdate({
          agent: agent.name,
          task,
          output: cumulative.finalOutput || "(running...)",
          exitCode: -1,
          elapsed: Date.now() - startedAt,
          tokens: cumulative.usage,
          model: cumulative.model,
        });
      }
    : undefined;

  // Abort signal handling
  let wasAborted = false;
  if (signal) {
    const killProc = () => {
      wasAborted = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
      }, 5000);
    };
    if (signal.aborted) {
      killProc();
    } else {
      signal.addEventListener("abort", killProc, { once: true });
    }
  }

  // Capture exit code — set up before parsing to avoid race
  const exitCodePromise = new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 0));
    proc.on("error", () => resolve(1));
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

  // Wait for process exit
  const exitCode = await exitCodePromise;

  // Cleanup
  if (stuckTimer) {
    clearInterval(stuckTimer);
  }

  const elapsed = Date.now() - startedAt;

  if (wasAborted) {
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

  const error =
    exitCode !== 0
      ? cumulative.errorMessage ||
        cumulative.stopReason ||
        stderr.trim() ||
        `exit code ${exitCode}`
      : undefined;

  return {
    agent: agent.name,
    task,
    output: cumulative.finalOutput,
    exitCode,
    elapsed,
    tokens: cumulative.usage,
    model: cumulative.model,
    error,
  };
}

// =============================================================================
// CLI arg construction
// =============================================================================

/**
 * Build CLI arguments for a child `pi -p` invocation from an agent config.
 * Returns an array suitable for `spawn("pi", args)`.
 */
export function buildCliArgs(agent: AgentConfig, task: string): string[] {
  const args = ["-p", "--mode", "json"];

  if (agent.noSession) {
    args.push("--no-session");
  }

  args.push("--model", agent.model);

  if (agent.thinking) {
    args.push("--thinking", agent.thinking);
  }

  if (agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  args.push(task);
  return args;
}
