import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPiInvocation } from "../src/lib/launch.js";
import { writeResearchScript } from "../src/lib/launch-script.js";
import { researchScriptPath } from "../src/lib/paths.js";
import { withAgentDir } from "./_helpers.js";

describe("writeResearchScript", () => {
  it("writes an executable script under <agentDir>/research-scripts/", () => {
    withAgentDir((dir) => {
      const path = writeResearchScript(
        "abc-123",
        "research widget refactor",
        "pi --session '/tmp/x.jsonl'",
      );
      expect(path).toBe(join(dir, "research-scripts", "abc-123.sh"));
      expect(existsSync(path)).toBe(true);
      // 0o755 → owner rwx
      expect(statSync(path).mode & 0o111).not.toBe(0);
    });
  });

  it("writes shebang, preamble, and the command verbatim", () => {
    withAgentDir(() => {
      const path = writeResearchScript(
        "abc-123",
        "research widget refactor",
        "PI_RSH_SESSION_ID='abc-123' pi --session '/tmp/x.jsonl'",
      );
      const content = readFileSync(path, "utf8");
      expect(content).toContain("#!/bin/bash");
      expect(content).toContain("# Research session: abc-123");
      expect(content).toContain("# Task: research widget refactor");
      expect(content).toContain(
        "PI_RSH_SESSION_ID='abc-123' pi --session '/tmp/x.jsonl'",
      );
    });
  });

  it("sanitizes newlines in the task comment", () => {
    withAgentDir(() => {
      const path = writeResearchScript("abc-123", "line1\nline2", "pi");
      const content = readFileSync(path, "utf8");
      expect(content).toContain("# Task: line1 line2");
    });
  });
});

describe("researchScriptPath", () => {
  it("resolves under <agentDir>/research-scripts/", () => {
    withAgentDir((dir) => {
      expect(researchScriptPath("abc-123")).toBe(
        join(dir, "research-scripts", "abc-123.sh"),
      );
    });
  });
});

describe("getPiInvocation", () => {
  it("returns an object with command and args", () => {
    const result = getPiInvocation(["-p", "--help"]);
    expect(result).toHaveProperty("command");
    expect(result).toHaveProperty("args");
    expect(typeof result.command).toBe("string");
    expect(Array.isArray(result.args)).toBe(true);
    expect(result.command.length).toBeGreaterThan(0);
  });

  it("includes the provided args in the result", () => {
    const result = getPiInvocation(["-p", "--mode", "json"]);
    // The args should contain the provided args somewhere in the array
    const allArgs = result.args.join(" ");
    expect(allArgs).toContain("-p");
    expect(allArgs).toContain("--mode");
    expect(allArgs).toContain("json");
  });

  it("returns a runnable command (starts with a path or 'pi')", () => {
    const result = getPiInvocation(["--version"]);
    // The command should either be 'pi' or an absolute/relative path
    expect(
      result.command === "pi" ||
        result.command.startsWith("/") ||
        result.command.includes("node") ||
        result.command.includes("bun"),
    ).toBe(true);
  });
});
