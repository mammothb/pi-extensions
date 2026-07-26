import { resolve, sep } from "node:path";
import type { SubagentResult } from "./types.js";

export function failedResult(
  agent: string,
  task: string,
  output: string,
): SubagentResult {
  return {
    agent,
    task,
    output,
    exitCode: 1,
    elapsed: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      turns: 0,
    },
    error: output,
  };
}

export function validateCwd(
  cwdParam: string | undefined,
  ctxCwd: string,
): { cwd: string } | { error: string } {
  const resolvedCwd = cwdParam ? resolve(cwdParam) : ctxCwd;
  if (!cwdParam) {
    return { cwd: resolvedCwd };
  }
  const resolvedCtxCwd = resolve(ctxCwd);
  if (
    resolvedCwd !== resolvedCtxCwd &&
    !resolvedCwd.startsWith(resolvedCtxCwd + sep)
  ) {
    return {
      error: `cwd "${cwdParam}" is outside the project directory "${ctxCwd}"`,
    };
  }
  return { cwd: resolvedCwd };
}
