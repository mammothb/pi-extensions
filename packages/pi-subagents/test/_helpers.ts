import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIG_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Point PI_CODING_AGENT_DIR at a fresh temp dir for the duration of `fn`,
 * then restore the original env and clean up — synchronously. The env and
 * temp dir are only guaranteed valid while this function is on the stack,
 * so async callbacks are rejected with a clear error: their continuations
 * would run after cleanup and could write into the removed directory.
 */
export function withAgentDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const result = fn(dir);
    if (isThenable(result)) {
      throw new Error(
        "withAgentDir does not support asynchronous callbacks: the temp " +
          "directory is removed and PI_CODING_AGENT_DIR restored when this " +
          "function returns, so async work would outlive the cleanup.",
      );
    }
    return result;
  } finally {
    if (ORIG_AGENT_DIR === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = ORIG_AGENT_DIR;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
