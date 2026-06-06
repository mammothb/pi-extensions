import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const __dirname = new URL(".", import.meta.url).pathname;

function getScriptPath(): string {
  // From src/lib/ go up 2 levels to package root, then bin/searxng
  return join(__dirname, "..", "..", "bin", "searxng");
}

function getInstancesDir(): string {
  return join(getAgentDir(), "searxng-instances");
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
  if (!existsSync(dir)) return;
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
 */
export function expandTilde(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return join(homedir(), filepath.slice(1));
  }
  return filepath;
}

export async function runScript(
  command: "up" | "down",
  scriptPath?: string,
): Promise<void> {
  const script = scriptPath ? expandTilde(scriptPath) : getScriptPath();
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
        if (stdout.trim()) console.log(stdout.trim());
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

  // No more live instances — shut down SearXNG
  try {
    await runScript("down", scriptPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`pi-websearch: failed to stop SearXNG: ${message}`);
  }
}
