import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock child_process
// ---------------------------------------------------------------------------

interface SpawnChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
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
import {
  cleanStaleLocks,
  expandTilde,
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

  it("calls runScript with 'down' when no other live instances remain", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ exitCode: 0 });

    await unregisterInstance();

    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      [expect.any(String), "down"],
      expect.any(Object),
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

  it("handles runScript failure gracefully during shutdown", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ exitCode: 1, stderr: "docker not found" });

    await expect(unregisterInstance()).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("pi-websearch: failed to stop SearXNG"),
    );
    consoleSpy.mockRestore();
  });

  it("forwards scriptPath to runScript for down", async () => {
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ exitCode: 0 });
    const customScript = "/usr/local/bin/my-searxng";

    await unregisterInstance(customScript);

    const scriptArg = (spawnMock.mock.calls[0]![1]! as string[])[0]!;
    expect(scriptArg).toBe(customScript);
  });

  it("handles non-Error rejection from runScript gracefully during shutdown", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const instancesDir = join(agentDir, "searxng-instances");
    mkdirSync(instancesDir, { recursive: true });
    writeFileSync(
      join(instancesDir, `${process.pid}.lock`),
      String(process.pid),
    );

    givenSpawn({ error: "spawn failed" as unknown as Error });

    await expect(unregisterInstance()).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      "pi-websearch: failed to stop SearXNG: spawn failed",
    );
    consoleSpy.mockRestore();
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

    // runScript should be called with "down" since all other locks are irrelevant
    expect(spawnMock).toHaveBeenCalledWith(
      "bash",
      [expect.any(String), "down"],
      expect.any(Object),
    );
  });
});
