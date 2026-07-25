import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { wrapWithBubblewrap } from "../src/lib/sandbox.js";

function hasBw(): boolean {
  try {
    // Test actual sandbox capability, not just binary presence.
    // bw --help may succeed even when bwrap is not installed.
    const result = spawnSync("bw", ["--", "true"], {
      stdio: "ignore",
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

const bwAvailable = hasBw();

// ---------------------------------------------------------------------------
// Pure-function tests (always run)
// ---------------------------------------------------------------------------

describe("wrapWithBubblewrap", () => {
  it("wraps command: 'pi' → 'bw' with -- separator", () => {
    const result = wrapWithBubblewrap("pi", ["-p", "--mode", "json"]);
    expect(result.command).toBe("bw");
    expect(result.args).toEqual(["--", "pi", "-p", "--mode", "json"]);
  });

  it("handles empty args", () => {
    const result = wrapWithBubblewrap("pi", []);
    expect(result.command).toBe("bw");
    expect(result.args).toEqual(["--", "pi"]);
  });

  it("preserves all original args in order", () => {
    const result = wrapWithBubblewrap("node", ["script.js", "--flag", "value"]);
    expect(result.args[0]).toBe("--");
    expect(result.args[1]).toBe("node");
    expect(result.args[2]).toBe("script.js");
    expect(result.args[3]).toBe("--flag");
    expect(result.args[4]).toBe("value");
  });
});

// ---------------------------------------------------------------------------
// Integration test — only runs when `bw` is on PATH
// ---------------------------------------------------------------------------

describe("sandbox integration", () => {
  it.runIf(bwAvailable)("'bw -- true' exits 0", () => {
    const result = spawnSync("bw", ["--", "true"], {
      stdio: "pipe",
      timeout: 5000,
    });
    expect(result.status).toBe(0);
  });
});
