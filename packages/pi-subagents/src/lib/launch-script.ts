import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { researchScriptLogPath, researchScriptPath } from "./paths.js";

/** Single-quote a string for shell use, handling embedded quotes. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Compose the shell command line for a research launch: env assignments
 * (values shell-quoted) followed by the quoted pi command and args.
 *
 * The env prefix must NOT be quoted as a whole — each `k=v` assignment is
 * already quoted, and re-quoting the prefix turns it into one bogus word
 * (bash: "PI_OFFLINE='1' ...: command not found").
 */
export function buildResearchCommandLine(
  env: Record<string, string>,
  commandParts: string[],
): string {
  const envPrefix = Object.entries(env)
    .map(([k, v]) => `${k}=${shq(v)}`)
    .join(" ");
  const quoted = commandParts.map(shq).join(" ");
  return `${envPrefix} ${quoted}`;
}

/**
 * Write an executable launch script containing the research pi command.
 * Keeps the full command out of the tmux split-window call and records
 * exactly what the child pane ran for debugging.
 */
export function writeResearchScript(
  sessionId: string,
  task: string,
  command: string,
): string {
  const path = researchScriptPath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "#!/bin/bash",
      `# Research session: ${sessionId}`,
      `# Task: ${task.replace(/\s+/g, " ")}`,
      `# Generated: ${new Date().toISOString()}`,
      // Keep stderr (e.g. command-not-found) for post-mortem — the pane
      // closes on exit and would otherwise swallow it.
      `exec 2>> ${shq(researchScriptLogPath(sessionId))}`,
      command,
      // Record the exit status in the log so a pane that dies with no
      // stderr still leaves a trail (clean-but-immediate exit vs crash).
      `echo "[research] exited with $?" >&2`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return path;
}
