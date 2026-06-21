import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { expandTilde } from "@mammothb/pi-shared";

const __dirname = new URL(".", import.meta.url).pathname;

function getScriptPath(): string {
  // From src/lib/ go up 2 levels to package root, then bin/searxng
  return join(__dirname, "..", "..", "bin", "searxng");
}

export function getInstancesDir(): string {
  return join(getAgentDir(), "searxng-instances");
}

/** Result of a shutdown health check. */
export interface ShutdownState {
  /** Number of PID files whose process is dead (unclean shutdown). */
  uncleanCount: number;
  /** Number of PID files whose process is still alive (shutdown in progress). */
  stillRunning: number;
  /**
   * Remove the shutdown PID files that were just inspected.
   * Call after reporting health status so stale files don't
   * trigger false positives on the next startup.
   */
  cleanup(): void;
}

/**
 * Check whether a PID is alive by sending signal 0.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove lock files belonging to dead PIDs.
 */
export function cleanStaleLocks(dir: string): void {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir)) {
    const pid = parseInt(entry.replace(/\.lock$/, ""), 10);
    if (!Number.isNaN(pid) && !isProcessAlive(pid)) {
      rmSync(join(dir, entry), { force: true });
    }
  }
}

/**
 * Run the searxng management script (up/down).
 * Uses the provided scriptPath, or falls back to the built-in `bin/searxng`.
 *
 * Waits for the child process to complete and captures stdout/stderr.
 * Use this when you need the exit code and output (e.g., for the `up` command).
 */
export async function runScript(
  command: "up" | "down",
  scriptPath?: string,
): Promise<void>;

/**
 * Run the searxng management script in detached mode.
 *
 * The child process is detached from the parent and will survive parent exit.
 * No output is captured and no exit code is available. Use this for
 * fire-and-forget commands (e.g., `docker compose down` during shutdown).
 *
 * @param opts.shutdownPidDir When set, the command is wrapped in a bash script
 *   that creates a `shutdown-<pid>.pid` file before running the command and
 *   removes it on exit. Enables cross-session health checks via
 *   {@link inspectShutdownState}.
 */
export function runScript(
  command: "up" | "down",
  scriptPath: string | undefined,
  opts: { detached: true; shutdownPidDir?: string },
): void;

export function runScript(
  command: "up" | "down",
  scriptPath?: string,
  opts?: { detached?: boolean; shutdownPidDir?: string },
): Promise<void> | void {
  const script = scriptPath ? expandTilde(scriptPath) : getScriptPath();

  // Detached mode: fire-and-forget, child survives parent exit
  if (opts?.detached) {
    if (opts.shutdownPidDir) {
      // Bash wrapper that tracks the down command via a PID file.
      // The wrapper creates shutdown-<pid>.pid, runs the script, then
      // removes the file. If the file remains on next startup, the
      // shutdown was unclean.
      const child = spawn(
        "bash",
        [
          "-c",
          `
          PID_FILE="${opts.shutdownPidDir}/shutdown-$$.pid"
          echo $$ > "$PID_FILE"
          "${script}" ${command}
          EXIT=$?
          rm -f "$PID_FILE"
          exit $EXIT
          `,
        ],
        {
          stdio: "ignore",
          detached: true,
        },
      );
      child.unref();
      child.on("error", (err) => {
        console.error(
          `pi-websearch: failed to run searxng ${command}: ${err.message}`,
        );
      });
    } else {
      const child = spawn("bash", [script, command], {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
      child.on("error", (err) => {
        console.error(
          `pi-websearch: failed to run searxng ${command}: ${err.message}`,
        );
      });
    }
    return;
  }

  // Default mode: wait for completion, capture output
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [script, command], {
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        if (stdout.trim()) {
          console.log(stdout.trim());
        }
        resolve();
      } else {
        reject(
          new Error(
            `searxng ${command} failed (exit ${code}): ${stderr || stdout}`,
          ),
        );
      }
    });

    child.on("error", reject);
  });
}

/**
 * Check for leftover shutdown PID files from previous sessions.
 *
 * Returns counts of unclean and still-running shutdowns, plus a
 * `cleanup()` method that removes the inspected PID files. Call
 * `cleanup()` after reporting to prevent false positives on the
 * next startup.
 */
export function inspectShutdownState(dir: string): ShutdownState {
  const pids: string[] = [];
  let uncleanCount = 0;
  let stillRunning = 0;

  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const match = entry.match(/^shutdown-(\d+)\.pid$/);
      if (!match) {
        continue;
      }

      const pidStr = match[1];
      if (!pidStr) {
        continue;
      }

      pids.push(entry);
      const pid = parseInt(pidStr, 10);
      if (isProcessAlive(pid)) {
        stillRunning++;
      } else {
        uncleanCount++;
      }
    }
  }

  return {
    uncleanCount,
    stillRunning,
    cleanup() {
      for (const entry of pids) {
        rmSync(join(dir, entry), { force: true });
      }
    },
  };
}

/**
 * Register the current pi instance as a searxng user.
 *
 * Creates a PID-based lock file in the instances directory, cleans up stale
 * locks, and starts SearXNG (if it's not already running). Safe to call
 * multiple times — it is idempotent.
 *
 * @param scriptPath Optional path to a custom management script.
 *   Must accept "up" and "down" commands. When set, used instead of the
 *   built-in `bin/searxng` script.
 */
export async function registerInstance(scriptPath?: string): Promise<void> {
  const dir = getInstancesDir();
  mkdirSync(dir, { recursive: true });

  // Remove locks belonging to dead processes
  cleanStaleLocks(dir);

  // Create / overwrite our lock file
  const lockFile = join(dir, `${process.pid}.lock`);
  writeFileSync(lockFile, String(process.pid));

  // Start SearXNG (idempotent — the script checks if already running)
  try {
    await runScript("up", scriptPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`pi-websearch: failed to start SearXNG: ${message}`);
  }
}

/**
 * Unregister the current pi instance.
 *
 * Removes our PID lock file. If no live instances remain, stops SearXNG.
 *
 * @param scriptPath Optional path to a custom management script.
 *   Must match the path passed to registerInstance.
 */
export async function unregisterInstance(scriptPath?: string): Promise<void> {
  const dir = getInstancesDir();

  // Remove our lock file
  const lockFile = join(dir, `${process.pid}.lock`);
  try {
    rmSync(lockFile, { force: true });
  } catch {
    // Ignore — best effort cleanup
  }

  // Check if any live instances remain
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      const pid = parseInt(entry.replace(/\.lock$/, ""), 10);
      if (!Number.isNaN(pid) && isProcessAlive(pid)) {
        return; // Another instance is still running
      }
    }
  }

  // No more live instances — shut down SearXNG.
  // Use detached mode with PID tracking so unclean shutdowns are detected
  // on the next startup via inspectShutdownState().
  runScript("down", scriptPath, { detached: true, shutdownPidDir: dir });
}
