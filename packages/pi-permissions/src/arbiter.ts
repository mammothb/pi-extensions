import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import type { GuardResult } from "./lib/types.js";

export const DEFAULT_ARBITER_TIMEOUT_MS = 5_000;

/**
 * Run the configured bash arbiter executable.
 *
 * Spawns the arbiter with the command as the first positional argument ($1).
 * Exit codes: 0 = allow, 1 = deny, 2 = ask. Any other exit code is
 * treated as deny (conservative). Stderr is captured and used as the
 * deny reason.
 *
 * @param command - The full bash command the agent wants to run
 * @param arbiterPath - Absolute path to the arbiter executable
 * @param timeoutMs - Timeout in milliseconds (default 5000)
 * @returns GuardResult with the resolved action
 */
export function runBashArbiter(
  command: string,
  arbiterPath: string,
  timeoutMs: number = DEFAULT_ARBITER_TIMEOUT_MS,
): Promise<GuardResult> {
  return new Promise((resolve) => {
    // Verify the arbiter exists and is executable
    try {
      accessSync(arbiterPath, constants.X_OK);
    } catch {
      resolve({
        action: "deny",
        reason: `bash arbiter not found or not executable: ${arbiterPath}`,
      });
      return;
    }

    const child = spawn(arbiterPath, [command], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        resolve({
          action: "deny",
          reason: `bash arbiter timed out after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve({
        action: "deny",
        reason: `bash arbiter failed to start: ${err.message}`,
      });
    });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);

      switch (exitCode) {
        case 0:
          resolve({ action: "allow", reason: "" });
          break;
        case 1:
          resolve({
            action: "deny",
            reason: stderr.trim() || `blocked by bash arbiter (exit code 1)`,
          });
          break;
        case 2:
          resolve({ action: "ask", reason: stderr.trim() || "" });
          break;
        default:
          resolve({
            action: "deny",
            reason:
              stderr.trim() ||
              `bash arbiter exited with unexpected code ${exitCode}`,
          });
      }
    });
  });
}
