import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

interface SpawnChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  unref: () => void;
}

// Store the mock implementation here so tests can control it
let mockSpawnImpl:
  | ((cmd: string, args: string[], opts: unknown) => SpawnChild)
  | null = null;

vi.mock("node:child_process", () => ({
  spawn: vi.fn((cmd: string, args: string[], opts: unknown): SpawnChild => {
    if (mockSpawnImpl) {
      return mockSpawnImpl(cmd, args, opts);
    }
    // Default: child that never settles (for safety)
    const child = new EventEmitter() as SpawnChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.unref = vi.fn();
    return child;
  }),
}));

// Import the mocked module
import { spawn } from "node:child_process";

const spawnMock = vi.mocked(spawn);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createChild(behavior: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
}): SpawnChild {
  const child = new EventEmitter() as SpawnChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  child.unref = vi.fn();

  // Settle on next tick so the promise has time to attach listeners
  setImmediate(() => {
    if (behavior.stdout) {
      child.stdout.emit("data", behavior.stdout);
    }
    if (behavior.stderr) {
      child.stderr.emit("data", behavior.stderr);
    }
    if (behavior.error) {
      child.emit("error", behavior.error);
    } else {
      child.emit("close", behavior.exitCode ?? 0);
    }
  });

  return child;
}

// Now import the module under test
import { expandTilde } from "@mammothb/pi-shared";
import {
  cleanStaleLocks,
  inspectShutdownState,
  isProcessAlive,
  registerInstance,
  runScript,
  unregisterInstance,
} from "../src/lib/searxng-manager";

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;
let agentDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `pi-websearch-mgr-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  agentDir = join(tmpDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Reset mocks
  spawnMock.mockReset();
  mockSpawnImpl = null;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Set the spawn behavior for the next call(s). */
function givenSpawn(behavior: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: Error;
}): void {
  mockSpawnImpl = (_cmd, _args, _opts) => createChild(behavior);
}

// ---------------------------------------------------------------------------
// expandTilde
// ---------------------------------------------------------------------------

describe("expandTilde", () => {
  it('expands "~/" to the home directory', () => {
    expect(expandTilde("~/foo/bar")).toBe(join(homedir(), "foo/bar"));
  });

  it('expands bare "~" to the home directory', () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("returns an absolute path unchanged", () => {
    expect(expandTilde("/usr/local/bin/script")).toBe("/usr/local/bin/script");
  });

  it("returns a relative path unchanged", () => {
    expect(expandTilde("./bin/searxng")).toBe("./bin/searxng");
  });
});

// ---------------------------------------------------------------------------
// isProcessAlive
// ---------------------------------------------------------------------------

describe("isProcessAlive", () => {
  it("returns true for the current PID", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for a very high PID that does not exist", () => {
    expect(isProcessAlive(9_999_999)).toBe(false);
  });

  it("returns false for a PID that does not exist on the system", () => {
    // Use two different high PIDs to be safe
    expect(isProcessAlive(9_999_998)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cleanStaleLocks
// ---------------------------------------------------------------------------

describe("cleanStaleLocks", () => {
  it("does nothing when the directory does not exist", () => {
    const dir = join(tmpDir, "nonexistent");
    expect(() => cleanStaleLocks(dir)).not.toThrow();
  });

  it("removes lock files belonging to dead PIDs", () => {
    const dir = join(tmpDir, "instances");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "9999999.lock"), "9999999");

    cleanStaleLocks(dir);

    expect(existsSync(join(dir, "9999999.lock"))).toBe(false);
  });

  it("keeps lock files belonging to live PIDs", () => {
    const dir = join(tmpDir, "instances");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${process.pid}.lock`), String(process.pid));

    cleanStaleLocks(dir);

    expect(existsSync(join(dir, `${process.pid}.lock`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runScript
// ---------------------------------------------------------------------------

describe("runScript", () => {
  it("resolves on successful exit (code 0)", async () => {
    givenSpawn({ exitCode: 0 });

    await expect(runScript("up")).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      [expect.any(String), "up"],
      expect.any(Object),
    );
  });

  it("resolves on successful down (code 0)", async () => {
    givenSpawn({ exitCode: 0 });

    await expect(runScript("down")).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      [expect.any(String), "down"],
      expect.any(Object),
    );
  });

  it("rejects with stderr on non-zero exit", async () => {
    givenSpawn({ exitCode: 1, stderr: "docker not found" });

    await expect(runScript("up")).rejects.toThrow(
      "searxng up failed (exit 1): docker not found",
    );
  });

  it("rejects with stdout when stderr is empty on non-zero exit", async () => {
    givenSpawn({ exitCode: 2, stdout: "something went wrong" });

    await expect(runScript("down")).rejects.toThrow(
      "searxng down failed (exit 2): something went wrong",
    );
  });

  it("rejects on spawn error (e.g. bash not found)", async () => {
    givenSpawn({ error: new Error("ENOENT: bash not found") });

    await expect(runScript("up")).rejects.toThrow("ENOENT: bash not found");
  });

  it("uses the default built-in script when no scriptPath is provided", async () => {
    givenSpawn({ exitCode: 0 });

    await runScript("up");
    const scriptArg = (spawnMock.mock.calls[0]![1]! as string[])[0]!;
    expect(scriptArg).toContain("bin/searxng");
  });

  it("uses the provided scriptPath with tilde expansion", async () => {
    givenSpawn({ exitCode: 0 });
    const customPath = "~/my-searxng-script";

    await runScript("up", customPath);
    const scriptArg = (spawnMock.mock.calls[0]![1]! as string[])[0]!;
    expect(scriptArg).toBe(join(homedir(), "my-searxng-script"));
  });

  it("logs stdout to console on success", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    givenSpawn({ exitCode: 0, stdout: "SearXNG is ready\n" });

    await runScript("up");

    expect(consoleSpy).toHaveBeenCalledWith("SearXNG is ready");
    consoleSpy.mockRestore();
  });

  it("does not log empty or whitespace-only stdout on success", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    givenSpawn({ exitCode: 0 });

    await runScript("up");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  describe("detached mode", () => {
    it("spawns with stdio ignore and detached true", () => {
      givenSpawn({ exitCode: 0 });

      runScript("down", undefined, { detached: true });

      expect(spawnMock).toHaveBeenCalledWith(
        "bash",
        [expect.any(String), "down"],
        { stdio: "ignore", detached: true },
      );
    });

    it("calls unref on the child so the parent event loop can exit", () => {
      givenSpawn({ exitCode: 0 });

      runScript("up", undefined, { detached: true });

      const child = spawnMock.mock.results[0]!.value as SpawnChild;
      expect(child.unref).toHaveBeenCalled();
    });

    it("returns void (does not return a Promise)", () => {
      givenSpawn({ exitCode: 0 });

      const result = runScript("down", undefined, { detached: true });

      expect(result).toBeUndefined();
    });

    it("logs spawn errors via console.error", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      givenSpawn({ error: new Error("ENOENT: bash not found") });

      runScript("down", undefined, { detached: true });

      // Wait for the setImmediate error event
      return new Promise<void>((resolve) => {
        setImmediate(() => {
          expect(consoleSpy).toHaveBeenCalledWith(
            "pi-websearch: failed to run searxng down: ENOENT: bash not found",
          );
          consoleSpy.mockRestore();
          resolve();
        });
      });
    });

    it("uses custom scriptPath with tilde expansion", () => {
      givenSpawn({ exitCode: 0 });
      const customPath = "~/my-searxng-script";

      runScript("down", customPath, { detached: true });

      const scriptArg = (spawnMock.mock.calls[0]![1]! as string[])[0]!;
      expect(scriptArg).toBe(join(homedir(), "my-searxng-script"));
    });

    it("does not log stdout even on success (output is ignored)", () => {
      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => {});
      givenSpawn({ exitCode: 0, stdout: "SearXNG stopped" });

      runScript("down", undefined, { detached: true });

      // stdout listener is not attached in detached mode, so log never fires
      expect(consoleLogSpy).not.toHaveBeenCalled();
      consoleLogSpy.mockRestore();
    });

    describe("with shutdownPidDir", () => {
      let instancesDir: string;

      beforeEach(() => {
        instancesDir = join(tmpDir, "instances");
        mkdirSync(instancesDir, { recursive: true });
      });

      it("spawns a bash wrapper with PID tracking", () => {
        givenSpawn({ exitCode: 0 });

        runScript("down", undefined, {
          detached: true,
          shutdownPidDir: instancesDir,
        });

        expect(spawnMock).toHaveBeenCalledWith(
          "bash",
          ["-c", expect.stringContaining("shutdown-$$.pid")],
          { stdio: "ignore", detached: true },
        );
      });

      it("calls unref on the child", () => {
        givenSpawn({ exitCode: 0 });

        runScript("down", undefined, {
          detached: true,
          shutdownPidDir: instancesDir,
        });

        const child = spawnMock.mock.results[0]!.value as SpawnChild;
        expect(child.unref).toHaveBeenCalled();
      });

      it("returns void", () => {
        givenSpawn({ exitCode: 0 });

        const result = runScript("down", undefined, {
          detached: true,
          shutdownPidDir: instancesDir,
        });

        expect(result).toBeUndefined();
      });

      it("logs spawn errors via console.error", () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});
        givenSpawn({ error: new Error("ENOENT: bash not found") });

        runScript("down", undefined, {
          detached: true,
          shutdownPidDir: instancesDir,
        });

        return new Promise<void>((resolve) => {
          setImmediate(() => {
            expect(consoleSpy).toHaveBeenCalledWith(
              "pi-websearch: failed to run searxng down: ENOENT: bash not found",
            );
            consoleSpy.mockRestore();
            resolve();
          });
        });
      });

      it("includes the instances dir in the bash wrapper", () => {
        givenSpawn({ exitCode: 0 });

        runScript("down", undefined, {
          detached: true,
          shutdownPidDir: instancesDir,
        });

        const wrapperScript = (spawnMock.mock.calls[0]![1]! as string[])[1]!;
        expect(wrapperScript).toContain(instancesDir);
      });

      it("includes the custom script path (tilde-expanded) in the wrapper", () => {
        givenSpawn({ exitCode: 0 });
        const customPath = "~/my-searxng-script";

        runScript("down", customPath, {
          detached: true,
          shutdownPidDir: instancesDir,
        });

        const wrapperScript = (spawnMock.mock.calls[0]![1]! as string[])[1]!;
        expect(wrapperScript).toContain(join(homedir(), "my-searxng-script"));
      });

      it("uses the default built-in script when no scriptPath is provided", () => {
        givenSpawn({ exitCode: 0 });

        runScript("down", undefined, {
          detached: true,
          shutdownPidDir: instancesDir,
        });

        const wrapperScript = (spawnMock.mock.calls[0]![1]! as string[])[1]!;
        expect(wrapperScript).toContain("bin/searxng");
      });
    });
  });
});

// ---------------------------------------------------------------------------
// inspectShutdownState
// ---------------------------------------------------------------------------

describe("inspectShutdownState", () => {
  let instancesDir: string;

  beforeEach(() => {
    instancesDir = join(tmpDir, "instances");
    mkdirSync(instancesDir, { recursive: true });
  });

  it("returns {0,0} with a no-op cleanup when the directory does not exist", () => {
    const result = inspectShutdownState(join(tmpDir, "nonexistent"));

    expect(result).toMatchObject({ uncleanCount: 0, stillRunning: 0 });
    expect(() => result.cleanup()).not.toThrow();
  });

  it("returns {0,0} when the directory is empty", () => {
    const result = inspectShutdownState(instancesDir);

    expect(result).toMatchObject({ uncleanCount: 0, stillRunning: 0 });
  });

  it("returns {0,0} when only lock files exist", () => {
    writeFileSync(join(instancesDir, "12345.lock"), "12345");
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    const result = inspectShutdownState(instancesDir);

    expect(result).toMatchObject({ uncleanCount: 0, stillRunning: 0 });
  });

  it("detects an unclean shutdown (dead PID)", () => {
    writeFileSync(join(instancesDir, "shutdown-9999999.pid"), "9999999");

    const result = inspectShutdownState(instancesDir);

    expect(result).toMatchObject({ uncleanCount: 1, stillRunning: 0 });
  });

  it("detects a still-running shutdown (live PID)", () => {
    writeFileSync(
      join(instancesDir, `shutdown-${process.pid}.pid`),
      String(process.pid),
    );

    const result = inspectShutdownState(instancesDir);

    expect(result).toMatchObject({ uncleanCount: 0, stillRunning: 1 });
  });

  it("counts multiple shutdown PID files correctly", () => {
    writeFileSync(join(instancesDir, "shutdown-9999999.pid"), "9999999");
    writeFileSync(join(instancesDir, "shutdown-9999998.pid"), "9999998");
    writeFileSync(
      join(instancesDir, `shutdown-${process.pid}.pid`),
      String(process.pid),
    );

    const result = inspectShutdownState(instancesDir);

    expect(result).toMatchObject({ uncleanCount: 2, stillRunning: 1 });
  });

  it("ignores non-matching files (garbage names)", () => {
    writeFileSync(join(instancesDir, "shutdown-abc.pid"), "abc");
    writeFileSync(join(instancesDir, "not-a-pid.txt"), "hello");
    writeFileSync(join(instancesDir, "shutdown-.pid"), "");
    writeFileSync(join(instancesDir, "12345.lock"), "12345");

    const result = inspectShutdownState(instancesDir);

    expect(result).toMatchObject({ uncleanCount: 0, stillRunning: 0 });
  });

  it("cleanup() removes all shutdown-*.pid files", () => {
    const file1 = join(instancesDir, "shutdown-12345.pid");
    const file2 = join(instancesDir, "shutdown-67890.pid");
    writeFileSync(file1, "12345");
    writeFileSync(file2, "67890");

    const result = inspectShutdownState(instancesDir);
    result.cleanup();

    expect(existsSync(file1)).toBe(false);
    expect(existsSync(file2)).toBe(false);
  });

  it("cleanup() does not remove lock files", () => {
    const lockFile = join(instancesDir, "12345.lock");
    const shutdownFile = join(instancesDir, "shutdown-12345.pid");
    writeFileSync(lockFile, "12345");
    writeFileSync(shutdownFile, "12345");

    const result = inspectShutdownState(instancesDir);
    result.cleanup();

    expect(existsSync(lockFile)).toBe(true);
    expect(existsSync(shutdownFile)).toBe(false);
  });

  it("cleanup() does not remove other unrelated files", () => {
    const otherFile = join(instancesDir, "README.txt");
    writeFileSync(otherFile, "hello");

    const result = inspectShutdownState(instancesDir);
    result.cleanup();

    expect(existsSync(otherFile)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerInstance
// ---------------------------------------------------------------------------

describe("registerInstance", () => {
  it("creates a lock file with the current PID", async () => {
    givenSpawn({ exitCode: 0 });

    await registerInstance();

    const lockFile = join(agentDir, "searxng-instances", `${process.pid}.lock`);
    expect(existsSync(lockFile)).toBe(true);
  });

  it("calls runScript with 'up'", async () => {
    givenSpawn({ exitCode: 0 });

    await registerInstance();

    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      [expect.any(String), "up"],
      expect.any(Object),
    );
  });

  it("cleans stale locks before creating its own", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(join(instancesDir, "9999999.lock"), "9999999");

    givenSpawn({ exitCode: 0 });

    await registerInstance();

    expect(existsSync(join(instancesDir, "9999999.lock"))).toBe(false);
    expect(existsSync(join(instancesDir, `${process.pid}.lock`))).toBe(true);
  });

  it("handles runScript failure gracefully without throwing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    givenSpawn({ exitCode: 1, stderr: "docker not found" });

    await expect(registerInstance()).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("pi-websearch: failed to start SearXNG"),
    );
    consoleSpy.mockRestore();
  });

  it("handles non-Error rejection from runScript gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    givenSpawn({ error: "something bad happened" as unknown as Error });

    await expect(registerInstance()).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      "pi-websearch: failed to start SearXNG: something bad happened",
    );
    consoleSpy.mockRestore();
  });

  it("forwards scriptPath to runScript", async () => {
    givenSpawn({ exitCode: 0 });
    const customScript = "/usr/local/bin/my-searxng";

    await registerInstance(customScript);

    const scriptArg = (spawnMock.mock.calls[0]![1]! as string[])[0]!;
    expect(scriptArg).toBe(customScript);
  });
});

// ---------------------------------------------------------------------------
// unregisterInstance
// ---------------------------------------------------------------------------

describe("unregisterInstance", () => {
  it("removes its own lock file", async () => {
    // First create the lock file
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ exitCode: 0 });

    await unregisterInstance();

    expect(existsSync(join(instancesDir, `${process.pid}.lock`))).toBe(false);
  });

  it("calls runScript with shutdownPidDir when no other live instances remain", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ exitCode: 0 });

    await unregisterInstance();

    // Spawns a bash wrapper that runs the down command with PID tracking
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      ["-c", expect.stringContaining(`" down`)],
      { stdio: "ignore", detached: true },
    );
  });

  it("does NOT call runScript with 'down' when another live instance exists", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    // Our lock
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );
    // Another "live" lock (same PID, different filename — simulates a sibling instance)
    writeFileSync(
      join(instancesDir, `${process.pid}-other.lock`),
      String(process.pid),
    );

    givenSpawn({ exitCode: 0 });

    await unregisterInstance();

    // runScript should NOT have been called with "down"
    const downCalls = spawnMock.mock.calls.filter(
      ([, args]) => (args as string[])[1] === "down",
    );
    expect(downCalls).toHaveLength(0);
  });

  it("logs spawn errors from the detached down process", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ error: new Error("ENOENT: bash not found") });

    await unregisterInstance();

    // The error is logged by runScript's internal error listener
    await new Promise<void>((resolve) => {
      setImmediate(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("pi-websearch: failed to run searxng down"),
        );
        consoleSpy.mockRestore();
        resolve();
      });
    });
  });

  it("forwards scriptPath to the detached down process", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ exitCode: 0 });
    const customScript = "/usr/local/bin/my-searxng";

    await unregisterInstance(customScript);

    // The custom script path appears inside the bash wrapper
    const wrapperScript = (spawnMock.mock.calls[0]![1]! as string[])[1]!;
    expect(wrapperScript).toContain(customScript);
  });

  it("returns immediately without waiting for the detached down process", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    // Default fallback child never settles — but unregisterInstance
    // doesn't wait for it in detached mode, so it resolves anyway.
    mockSpawnImpl = null;

    await expect(unregisterInstance()).resolves.toBeUndefined();
  });

  it("shuts down when remaining lock files are non-numeric or dead PIDs", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    // Our lock
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );
    // Non-numeric lock (should be ignored)
    writeFileSync(join(instancesDir, "not-a-pid.lock"), "not-a-pid");
    // Dead PID lock
    writeFileSync(join(instancesDir, "9999999.lock"), "9999999");

    givenSpawn({ exitCode: 0 });

    await unregisterInstance();

    // Detached down with PID tracking should be called since all other locks are irrelevant
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      ["-c", expect.stringContaining(`" down`)],
      { stdio: "ignore", detached: true },
    );
  });
});
