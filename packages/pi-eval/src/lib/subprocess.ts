import { spawn } from "node:child_process";
import { MAX_OUTPUT } from "./format.js";
import {
  EvalCancelledError,
  EvalSpawnError,
  EvalTimeoutError,
  type SubprocessResult,
} from "./types.js";

/**
 * Spawn a subprocess and capture stdout/stderr.
 *
 * @throws {EvalTimeoutError} when {@link timeoutSignal} fires
 * @throws {EvalCancelledError} when {@link userSignal} fires
 * @throws {EvalSpawnError} when the process fails to start
 */
export function run(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  userSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): Promise<SubprocessResult> {
  return new Promise((resolvePromise, reject) => {
    // Combine signals for spawn (either will kill the child)
    const combinedSignal = userSignal
      ? AbortSignal.any([userSignal, timeoutSignal])
      : timeoutSignal;

    const child = spawn(file, args, {
      cwd,
      env,
      signal: combinedSignal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;

    const onData = (target: "stdout" | "stderr") => (chunk: Buffer) => {
      const used = stdout.length + stderr.length;
      const remaining = MAX_OUTPUT - used;
      if (remaining <= 0) {
        truncated = true;
        child.kill();
        return;
      }
      // If the chunk is larger than remaining capacity, only keep what fits
      // and mark as truncated immediately (don't wait for the next chunk).
      const fits = Math.min(chunk.length, remaining);
      const text = chunk.toString("utf-8", 0, fits);
      if (target === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      if (fits < chunk.length) {
        truncated = true;
        child.kill();
      }
    };

    child.stdout.on("data", onData("stdout"));
    child.stderr.on("data", onData("stderr"));

    let settled = false;

    child.on("close", (exitCode, exitSignal) => {
      if (settled) {
        return;
      }
      // Truncation kill (we killed it) — resolve with partial output.
      // Treat as a normal termination: the truncated flag communicates the
      // condition, not the exit signal.
      if (truncated) {
        settled = true;
        resolvePromise({
          stdout,
          stderr,
          exitCode: 0,
          exitSignal: null,
          truncated: true,
        });
        return;
      }
      // Check our abort signals first (they kill the child via spawn's signal option)
      if (timeoutSignal.aborted) {
        settled = true;
        reject(new EvalTimeoutError());
        return;
      }
      if (userSignal?.aborted) {
        settled = true;
        reject(new EvalCancelledError());
        return;
      }
      // Normal exit (exitCode may be null if killed by an external signal)
      settled = true;
      resolvePromise({
        stdout,
        stderr,
        exitCode,
        exitSignal,
        truncated,
      });
    });

    child.on("error", (err) => {
      if (settled) {
        return;
      }
      // Abort during spawn: Node throws an error before the process starts.
      // Discriminate which signal caused it.
      if (timeoutSignal.aborted) {
        settled = true;
        reject(new EvalTimeoutError());
        return;
      }
      if (userSignal?.aborted) {
        settled = true;
        reject(new EvalCancelledError());
        return;
      }
      settled = true;
      reject(new EvalSpawnError(file, err.message));
    });
  });
}
