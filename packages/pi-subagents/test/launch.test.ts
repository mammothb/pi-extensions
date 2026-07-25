import { describe, expect, it } from "vitest";
import {
  buildCliArgs,
  getPiInvocation,
  spawnChild,
} from "../src/lib/launch.js";
import type { AgentConfig } from "../src/lib/types.js";

const nodeBin = process.execPath;

const baseAgent: AgentConfig = {
  name: "test-agent",
  description: "",
  model: "google/gemini-2.5-flash",
  thinking: "",
  tools: [],
  mode: "clean",
  sandbox: false,
  noSession: true,
  body: "",
};

describe("buildCliArgs", () => {
  it("includes --no-session when noSession is true", () => {
    const args = buildCliArgs(baseAgent, "do something");
    expect(args).toContain("--no-session");
  });

  it("omits --no-session when noSession is false", () => {
    const agent = { ...baseAgent, noSession: false };
    const args = buildCliArgs(agent, "do something");
    expect(args).not.toContain("--no-session");
  });

  it("omits --thinking when thinking is empty string", () => {
    const args = buildCliArgs(baseAgent, "do something");
    expect(args).not.toContain("--thinking");
  });

  it("includes --thinking when thinking is set", () => {
    const agent = { ...baseAgent, thinking: "high" };
    const args = buildCliArgs(agent, "do something");
    expect(args).toContain("--thinking");
    const idx = args.indexOf("--thinking");
    expect(args[idx + 1]).toBe("high");
  });

  it("omits --tools when tools array is empty", () => {
    const args = buildCliArgs(baseAgent, "do something");
    expect(args).not.toContain("--tools");
  });

  it("includes --tools with comma-separated names when tools is non-empty", () => {
    const agent = { ...baseAgent, tools: ["read", "edit", "bash"] };
    const args = buildCliArgs(agent, "do something");
    expect(args).toContain("--tools");
    const idx = args.indexOf("--tools");
    expect(args[idx + 1]).toBe("read,edit,bash");
  });

  it("always includes --model", () => {
    const args = buildCliArgs(baseAgent, "do something");
    expect(args).toContain("--model");
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("google/gemini-2.5-flash");
  });

  it("places task string as the last argument", () => {
    const task = "fix the bug in src/auth.ts";
    const args = buildCliArgs(baseAgent, task);
    expect(args[args.length - 1]).toBe(task);
  });

  it("starts with -p and --mode json", () => {
    const args = buildCliArgs(baseAgent, "do something");
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("--mode");
    expect(args[2]).toBe("json");
  });
});

// =============================================================================
// getPiInvocation
// =============================================================================

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

// =============================================================================
// spawnChild (low-level)
// =============================================================================

describe("spawnChild", () => {
  it("spawns a process that exits successfully", async () => {
    const proc = spawnChild(
      nodeBin,
      ["-e", "console.log('hello')"],
      process.cwd(),
    );

    const exitCode = await new Promise<number>((resolve) => {
      proc.on("close", resolve);
      proc.on("error", () => resolve(1));
    });

    expect(exitCode).toBe(0);
  });

  it("captures stdout from the child process", async () => {
    const proc = spawnChild(
      nodeBin,
      ["-e", "console.log('hello stdout')"],
      process.cwd(),
    );

    const stdout = await new Promise<string>((resolve) => {
      let output = "";
      proc.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });
      proc.on("close", () => resolve(output));
      proc.on("error", () => resolve(""));
    });

    expect(stdout).toContain("hello stdout");
  });

  it("captures stderr from the child process", async () => {
    const proc = spawnChild(
      nodeBin,
      ["-e", "console.error('hello stderr')"],
      process.cwd(),
    );

    const stderr = await new Promise<string>((resolve) => {
      let output = "";
      proc.stderr?.on("data", (data: Buffer) => {
        output += data.toString();
      });
      proc.on("close", () => resolve(output));
      proc.on("error", () => resolve(""));
    });

    expect(stderr).toContain("hello stderr");
  });

  it("returns non-zero exit code for failing process", async () => {
    const proc = spawnChild(nodeBin, ["-e", "process.exit(42)"], process.cwd());

    const exitCode = await new Promise<number>((resolve) => {
      proc.on("close", resolve);
      proc.on("error", () => resolve(-1));
    });

    expect(exitCode).toBe(42);
  });

  it("respects cwd parameter", async () => {
    const proc = spawnChild(
      nodeBin,
      ["-e", "console.log(process.cwd())"],
      "/tmp",
    );

    const stdout = await new Promise<string>((resolve) => {
      let output = "";
      proc.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });
      proc.on("close", () => resolve(output.trim()));
      proc.on("error", () => resolve(""));
    });

    expect(stdout).toBe("/tmp");
  });
});
