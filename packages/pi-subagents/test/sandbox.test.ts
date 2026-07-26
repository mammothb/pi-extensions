import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { wrapWithBubblewrap } from "../src/lib/sandbox.js";
import { bwAvailable } from "./helpers.js";

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
  it.runIf(bwAvailable)(
    "/tmp inside sandbox is isolated from host /tmp",
    () => {
      // Create a sentinel file on the host's /tmp
      const sentinel = `bw-sandbox-test-${Date.now()}`;
      const hostPath = `/tmp/${sentinel}`;
      writeFileSync(hostPath, "sentinel");

      try {
        // Inside the sandbox /tmp is a fresh tmpfs — sentinel must not exist
        const result = spawnSync("bw", ["--", "cat", hostPath], {
          stdio: "pipe",
          timeout: 5000,
        });
        expect(result.status).not.toBe(0);
      } finally {
        try {
          unlinkSync(hostPath);
        } catch {
          /* best-effort */
        }
      }
    },
  );
});
