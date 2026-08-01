import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { researchScriptPath } from "./paths.js";

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
      command,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return path;
}
