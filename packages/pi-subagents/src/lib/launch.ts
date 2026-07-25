import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { AgentConfig } from "./types.js";

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
