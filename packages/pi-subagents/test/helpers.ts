import { spawnSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Probe whether the bubblewrap sandbox (`bw`) is available and functional.
 * Tests actual sandbox capability, not just binary presence.
 * `bw --help` may succeed even when `bwrap` is not installed.
 */
export function hasBw(): boolean {
  try {
    const result = spawnSync("bw", ["--", "true"], {
      stdio: "ignore",
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export const bwAvailable = hasBw();

export interface MakeCtxOptions {
  getSessionFile?: () => string | undefined;
}

/**
 * Build a minimal ExtensionContext stub for tool tests.
 */
export function makeCtx(
  cwd: string,
  opts: MakeCtxOptions = {},
): ExtensionContext {
  return {
    cwd,
    sessionManager: {
      getSessionFile: opts.getSessionFile ?? (() => undefined),
    },
  } as unknown as ExtensionContext;
}
