import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIG_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

/**
 * Point PI_CODING_AGENT_DIR at a fresh temp dir for the duration of `fn`,
 * then restore the original env and clean up.
 */
export function withAgentDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (ORIG_AGENT_DIR === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = ORIG_AGENT_DIR;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
