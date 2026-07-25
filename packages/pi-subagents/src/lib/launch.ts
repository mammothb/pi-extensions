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

interface CumulativeResult {
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
    if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          return part.text;
        }
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
