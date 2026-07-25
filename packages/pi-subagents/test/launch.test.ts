import { describe, expect, it } from "vitest";
import { buildCliArgs } from "../src/lib/launch.js";
import type { AgentConfig } from "../src/lib/types.js";

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
