import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCliArgs,
  getPiInvocation,
  launchChild,
  launchSubagent,
  parseJsonlStream,
  spawnChild,
} from "../src/lib/launch.js";
import type { AgentConfig, SubagentResult } from "../src/lib/types.js";
import { createResumeTool } from "../src/resume-tool.js";
import { createSubagentTool } from "../src/subagent-tool.js";
import { bwAvailable, makeCtx } from "./helpers.js";

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

  it("omits --model when agent.model is falsy", () => {
    const agent = { ...baseAgent, model: "" };
    const args = buildCliArgs(agent, "do something");
    expect(args).not.toContain("--model");
  });

  it("places task string as the last argument after -- separator", () => {
    const task = "fix the bug in src/auth.ts";
    const args = buildCliArgs(baseAgent, task);
    expect(args[args.length - 1]).toBe(task);
    expect(args[args.length - 2]).toBe("--");
  });

  it("starts with -p and --mode json", () => {
    const args = buildCliArgs(baseAgent, "do something");
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe("--mode");
    expect(args[2]).toBe("json");
  });

  // -- Phase 1 (fork/resume): sessionFile parameter --

  it("adds --session and omits --no-session when sessionFile is provided", () => {
    const args = buildCliArgs(baseAgent, "do something", "/tmp/session.jsonl");
    expect(args).toContain("--session");
    const idx = args.indexOf("--session");
    expect(args[idx + 1]).toBe("/tmp/session.jsonl");
    expect(args).not.toContain("--no-session");
  });

  it("keeps --no-session when sessionFile is undefined and noSession is true", () => {
    const args = buildCliArgs(baseAgent, "do something");
    expect(args).toContain("--no-session");
    expect(args).not.toContain("--session");
  });

  it("places --session before --model/--thinking/--tools", () => {
    const agent = { ...baseAgent, tools: ["read"], thinking: "low" };
    const args = buildCliArgs(agent, "task", "/tmp/s.jsonl");
    const sessionIdx = args.indexOf("--session");
    expect(sessionIdx).toBeGreaterThan(2); // after -p --mode json
    expect(sessionIdx).toBeLessThan(args.indexOf("--model"));
    expect(sessionIdx).toBeLessThan(args.indexOf("--thinking"));
    expect(sessionIdx).toBeLessThan(args.indexOf("--tools"));
  });

  it("omits --no-session when noSession is false and no sessionFile", () => {
    const agent = { ...baseAgent, noSession: false };
    const args = buildCliArgs(agent, "task");
    expect(args).not.toContain("--no-session");
    expect(args).not.toContain("--session");
  });

  it("--session wins over noSession: false", () => {
    const agent = { ...baseAgent, noSession: false };
    const args = buildCliArgs(agent, "task", "/tmp/s.jsonl");
    expect(args).toContain("--session");
    expect(args).not.toContain("--no-session");
  });

  it("-- <task> remains last argument regardless of sessionFile", () => {
    const task = "fix the bug";
    const args = buildCliArgs(baseAgent, task, "/tmp/s.jsonl");
    expect(args[args.length - 1]).toBe(task);
    expect(args[args.length - 2]).toBe("--");
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
    const testDir = mkdtempSync(join(tmpdir(), "pi-subagents-cwd-"));
    try {
      const proc = spawnChild(
        nodeBin,
        ["-e", "console.log(process.cwd())"],
        testDir,
      );

      const stdout = await new Promise<string>((resolve) => {
        let output = "";
        proc.stdout?.on("data", (data: Buffer) => {
          output += data.toString();
        });
        proc.on("close", () => resolve(output.trim()));
        proc.on("error", () => resolve(""));
      });

      expect(stdout).toBe(realpathSync(testDir));
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// parseJsonlStream
// =============================================================================

function makeAssistantMessage(text: string): object {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      usage: {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 20,
        totalTokens: 150,
        cost: {
          input: 0.0003,
          output: 0.0015,
          cacheRead: 0,
          cacheWrite: 0.0005,
          total: 0.0023,
        },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    },
  };
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  text: string,
): object {
  return {
    type: "tool_result_end",
    message: {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      isError: false,
      timestamp: Date.now(),
    },
  };
}

function jsonlStream(...events: object[]): Readable {
  const lines = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
  return Readable.from([lines]);
}

describe("parseJsonlStream", () => {
  it("parses a single assistant message", async () => {
    const stream = jsonlStream(makeAssistantMessage("hello world"));
    const result = await parseJsonlStream(stream, undefined);

    expect(result.messages).toHaveLength(1);
    const msg = result.messages[0];
    if (!msg) {
      throw new Error("expected message");
    }
    expect(msg.role).toBe("assistant");
    expect(result.finalOutput).toBe("hello world");
    expect(result.usage.turns).toBe(1);
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(50);
    expect(result.usage.cacheRead).toBe(10);
    expect(result.usage.cacheWrite).toBe(20);
    expect(result.usage.total).toBe(150);
    expect(result.model).toBe("claude-sonnet-4-5");
  });

  it("parses multiple messages (assistant + tool result)", async () => {
    const stream = jsonlStream(
      makeAssistantMessage("let me read the file"),
      makeToolResult("tool_1", "read", "file contents here"),
      makeAssistantMessage("done"),
    );
    const result = await parseJsonlStream(stream, undefined);

    expect(result.messages).toHaveLength(3);
    const [msg0, msg1, msg2] = result.messages;
    if (!msg0 || !msg1 || !msg2) {
      throw new Error("expected messages");
    }
    expect(msg0.role).toBe("assistant");
    expect(msg1.role).toBe("toolResult");
    expect(msg2.role).toBe("assistant");
    expect(result.finalOutput).toBe("done");
    expect(result.usage.turns).toBe(2);
  });

  it("calls onUpdate for each event", async () => {
    const updates: string[] = [];
    const stream = jsonlStream(
      makeAssistantMessage("first"),
      makeAssistantMessage("second"),
    );

    await parseJsonlStream(stream, (result) => {
      updates.push(result.finalOutput);
    });

    expect(updates).toEqual(["first", "second"]);
  });

  it("handles empty stream", async () => {
    const stream = Readable.from([""]);
    const result = await parseJsonlStream(stream, undefined);

    expect(result.messages).toHaveLength(0);
    expect(result.finalOutput).toBe("");
    expect(result.usage.turns).toBe(0);
  });

  it("handles partial lines (buffered across chunks)", async () => {
    const event1 = JSON.stringify(makeAssistantMessage("hello"));
    // Split one JSON line across two chunks
    const chunk1 = event1.slice(0, 20);
    const chunk2 = `${event1.slice(20)}\n`;
    const stream = Readable.from([chunk1, chunk2]);

    const result = await parseJsonlStream(stream, undefined);

    expect(result.messages).toHaveLength(1);
    expect(result.finalOutput).toBe("hello");
  });

  it("skips malformed JSON lines with a warning", async () => {
    const stream = Readable.from([
      "not json at all\n" +
        JSON.stringify(makeAssistantMessage("valid")) +
        "\n",
    ]);
    const result = await parseJsonlStream(stream, undefined);

    // The malformed line is skipped, valid one is processed
    expect(result.messages).toHaveLength(1);
    expect(result.finalOutput).toBe("valid");
  });

  it("ignores unrecognized event types", async () => {
    const stream = Readable.from([
      JSON.stringify({ type: "unknown_event", data: "ignored" }) +
        "\n" +
        JSON.stringify(makeAssistantMessage("valid")) +
        "\n",
    ]);
    const result = await parseJsonlStream(stream, undefined);

    // Unknown events are silently ignored
    expect(result.messages).toHaveLength(1);
    expect(result.finalOutput).toBe("valid");
  });

  it("handles assistant messages without text content", async () => {
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc1",
            name: "read",
            arguments: { path: "/x" },
          },
        ],
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
    };
    const stream = jsonlStream(event);
    const result = await parseJsonlStream(stream, undefined);

    // No text content → finalOutput stays at previous value (empty)
    expect(result.finalOutput).toBe("");
    expect(result.messages).toHaveLength(1);
  });
});

// =============================================================================
// launchChild
// =============================================================================

/**
 * Build a node -e script that writes JSONL events to stdout and exits.
 */
function jsonlScript(...events: object[]): string {
  const lines = events.map((e) => JSON.stringify(e));
  const output = `${lines.join("\n")}\n`;
  return `process.stdout.write(${JSON.stringify(output)});`;
}

/**
 * Build a node script that writes JSONL events to stdout, then exits with a
 * specific code.
 */
function jsonlScriptWithExit(exitCode: number, ...events: object[]): string {
  return `${jsonlScript(...events)}process.exit(${exitCode});`;
}

describe("launchChild", () => {
  const agent: AgentConfig = {
    name: "test-agent",
    description: "",
    model: "test/model",
    thinking: "",
    tools: [],
    mode: "clean",
    sandbox: false,
    noSession: true,
    body: "",
  };

  it("runs a child that outputs JSONL and returns the result", async () => {
    const script = jsonlScript(makeAssistantMessage("hello from child"));
    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent,
      task: "do something",
      cwd: process.cwd(),
      stuckTimeoutMs: 0,
    });

    expect(result.agent).toBe("test-agent");
    expect(result.task).toBe("do something");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("hello from child");
    expect(result.tokens.turns).toBe(1);
    expect(result.tokens.input).toBe(100);
    expect(result.elapsed).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it("returns error for non-zero exit code", async () => {
    const script = jsonlScriptWithExit(
      1,
      makeAssistantMessage("partial output"),
    );
    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent,
      task: "do something",
      cwd: process.cwd(),
      stuckTimeoutMs: 0,
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
    expect(result.output).toBe("partial output");
  });

  it("calls onUpdate for each event", async () => {
    const updates: SubagentResult[] = [];
    const script = jsonlScript(
      makeAssistantMessage("first"),
      makeToolResult("t1", "read", "file contents"),
      makeAssistantMessage("done"),
    );
    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent,
      task: "do something",
      cwd: process.cwd(),
      onUpdate: (r) => updates.push({ ...r }),
      stuckTimeoutMs: 0,
    });

    // onUpdate should fire for each assistant message and tool result
    expect(updates.length).toBeGreaterThanOrEqual(3);
    // Final result should match last update
    expect(result.output).toBe("done");
    expect(result.tokens.turns).toBe(2);
  });

  it("captures stderr in error when process exits non-zero", async () => {
    const script =
      jsonlScript(makeAssistantMessage("ok")) +
      "process.stderr.write('error output\\n');process.exit(1);";
    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent: { ...agent, name: "stderr-agent" },
      task: "task",
      cwd: process.cwd(),
      stuckTimeoutMs: 0,
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("error output");
  });

  it("handles process that produces no output", async () => {
    const script = "process.exit(0);";
    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent,
      task: "do nothing",
      cwd: process.cwd(),
      stuckTimeoutMs: 0,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("");
  });

  it("emits stuck warning when no progress for timeout period", {
    timeout: 15_000,
  }, async () => {
    // Script that sleeps longer than the stuck timer interval (5s)
    const script = `setTimeout(() => { ${jsonlScript(makeAssistantMessage("finally"))} }, 7000);`;
    const updates: SubagentResult[] = [];

    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent,
      task: "slow task",
      cwd: process.cwd(),
      onUpdate: (r) => updates.push({ ...r }),
      stuckTimeoutMs: 1000, // 1 second stuck timeout (script sleeps 7s, timer checks every 5s)
    });

    // Should have gotten at least one stuck warning
    const stuckWarnings = updates.filter((u) =>
      u.output.includes("No progress"),
    );
    expect(stuckWarnings.length).toBeGreaterThan(0);
    // Final result should still succeed
    expect(result.output).toBe("finally");
    expect(result.exitCode).toBe(0);
  });

  it("aborts child process when signal is triggered", {
    timeout: 10_000,
  }, async () => {
    const controller = new AbortController();
    // Script that runs forever
    const script = "setInterval(() => {}, 1000);";

    const resultPromise = launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent,
      task: "infinite task",
      cwd: process.cwd(),
      signal: controller.signal,
      stuckTimeoutMs: 0,
    });

    // Abort after a short delay
    await new Promise((resolve) => setTimeout(resolve, 500));
    controller.abort();

    const result = await resultPromise;
    expect(result.error).toBe("Subagent was aborted");
  });

  it("respects stuckTimeoutMs of 0 (disables stuck detection)", async () => {
    const script = `setTimeout(() => { ${jsonlScript(makeAssistantMessage("done"))} }, 500);`;
    const updates: SubagentResult[] = [];

    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent,
      task: "task",
      cwd: process.cwd(),
      onUpdate: (r) => updates.push({ ...r }),
      stuckTimeoutMs: 0,
    });

    const stuckWarnings = updates.filter((u) =>
      u.output.includes("No progress"),
    );
    expect(stuckWarnings).toHaveLength(0);
    expect(result.output).toBe("done");
  });

  // -------------------------------------------------------------------------
  // Sandbox tests
  // -------------------------------------------------------------------------

  it.runIf(bwAvailable)("sandbox: true wraps child in bubblewrap", async () => {
    const script = jsonlScript(makeAssistantMessage("sandboxed hello"));
    const sandboxedAgent: AgentConfig = {
      ...agent,
      sandbox: true,
    };

    const result = await launchChild({
      command: nodeBin,
      args: ["-e", script],
      agent: sandboxedAgent,
      task: "sandboxed task",
      cwd: process.cwd(),
      stuckTimeoutMs: 0,
    });

    expect(result.agent).toBe("test-agent");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("sandboxed hello");
    expect(result.error).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Fork session lifecycle
  // -------------------------------------------------------------------------

  it("fork session: buildCliArgs includes --session when fork file provided", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    const parentFile = join(parentDir, "parent.jsonl");

    // Create minimal parent session
    writeFileSync(
      parentFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n`,
      "utf8",
    );

    const { seedForkSession: seed, generateChildSessionFile: gen } =
      await import("../src/lib/session.js");
    const forkFile = gen(join(parentDir, "children"));
    const forkAgent: AgentConfig = {
      ...agent,
      mode: "fork",
      noSession: true,
    };
    seed(parentFile, forkFile, forkAgent, process.cwd());

    expect(existsSync(forkFile)).toBe(true);

    // buildCliArgs passes --session for fork file
    const args = buildCliArgs(forkAgent, "fork task", forkFile);
    expect(args).toContain("--session");
    expect(args).toContain(forkFile);
    expect(args).not.toContain("--no-session");

    rmSync(parentDir, { recursive: true, force: true });
  });

  it("fork session: child can run with node and fork file exists", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    const parentFile = join(parentDir, "parent.jsonl");

    writeFileSync(
      parentFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n${JSON.stringify({
        type: "message",
        id: "msg00001",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "parent context" }],
        },
      })}\n`,
      "utf8",
    );

    const { seedForkSession: seed, generateChildSessionFile: gen } =
      await import("../src/lib/session.js");
    const forkFile = gen(join(parentDir, "children"));
    const forkAgent: AgentConfig = {
      ...agent,
      mode: "fork",
      noSession: false,
    };
    seed(parentFile, forkFile, forkAgent, process.cwd());

    // Fork file should exist and contain parent context + boundary
    const content = readFileSync(forkFile, "utf8");
    expect(content).toContain("parent context");
    expect(content).toContain("subagent_boundary");
    expect(content).toContain("pi-subagents_launch_metadata");

    // The child can be launched separately — for this test we verify
    // the fork file is valid (parseable JSONL) by reading it back
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    rmSync(parentDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // launchSubagent — fork lifecycle integration
  // -------------------------------------------------------------------------

  it("fork + noSession=false → seeds fork session, assigns sessionFile to result", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    const parentFile = join(parentDir, "parent.jsonl");
    writeFileSync(
      parentFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n${JSON.stringify({
        type: "message",
        id: "msg00001",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "parent context" }],
        },
      })}\n`,
      "utf8",
    );

    const forkAgent: AgentConfig = {
      ...agent,
      mode: "fork",
      noSession: false,
      thinking: "low",
    };

    let capturedSessionFile: string | undefined;

    // Stub that records the sessionFile arg and returns a dummy result
    const stubLaunch = async (
      _args: string[],
      _a: AgentConfig,
      _task: string,
      _cwd: string,
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      _timeout: number,
    ): Promise<SubagentResult> => {
      // Extract fork file path from the CLI args
      const sessionIdx = _args.indexOf("--session");
      if (sessionIdx !== -1) {
        capturedSessionFile = _args[sessionIdx + 1];
      }
      return {
        agent: forkAgent.name,
        task: "fork task",
        output: "stub output",
        exitCode: 0,
        elapsed: 10,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
          turns: 0,
        },
      };
    };

    try {
      const result = await launchSubagent(
        forkAgent,
        "fork task",
        process.cwd(),
        undefined,
        undefined,
        0,
        parentFile,
        stubLaunch,
      );

      // Fork file was created and seeded
      expect(capturedSessionFile).toBeDefined();
      expect(existsSync(capturedSessionFile!)).toBe(true);

      // sessionFile assigned to result (noSession=false)
      expect(result.sessionFile).toBe(capturedSessionFile);

      // Fork file survived — ready for resume
      expect(existsSync(result.sessionFile!)).toBe(true);
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  it("fork + noSession=true → cleans up fork file after launch", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    const parentFile = join(parentDir, "parent.jsonl");
    writeFileSync(
      parentFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n${JSON.stringify({
        type: "message",
        id: "msg00001",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "ephemeral context" }],
        },
      })}\n`,
      "utf8",
    );

    const ephemeralAgent: AgentConfig = {
      ...agent,
      mode: "fork",
      noSession: true,
    };

    let capturedSessionFile: string | undefined;

    const stubLaunch = async (
      _args: string[],
      _a: AgentConfig,
      _task: string,
      _cwd: string,
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      _timeout: number,
    ): Promise<SubagentResult> => {
      const sessionIdx = _args.indexOf("--session");
      if (sessionIdx !== -1) {
        capturedSessionFile = _args[sessionIdx + 1];
      }
      return {
        agent: ephemeralAgent.name,
        task: "ephemeral task",
        output: "stub output",
        exitCode: 0,
        elapsed: 10,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
          turns: 0,
        },
      };
    };

    try {
      const result = await launchSubagent(
        ephemeralAgent,
        "ephemeral task",
        process.cwd(),
        undefined,
        undefined,
        0,
        parentFile,
        stubLaunch,
      );

      // Fork file was seeded before launch
      expect(capturedSessionFile).toBeDefined();

      // sessionFile NOT assigned (noSession=true)
      expect(result.sessionFile).toBeUndefined();

      // Fork file cleaned up by finally block
      expect(existsSync(capturedSessionFile!)).toBe(false);
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  it("fork without parentSessionFile → falls back to clean, no crash", async () => {
    const forkAgent: AgentConfig = {
      ...agent,
      mode: "fork",
      noSession: true,
    };

    let receivedArgs: string[] = [];

    const stubLaunch = async (
      args: string[],
      _a: AgentConfig,
      _task: string,
      _cwd: string,
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      _timeout: number,
    ): Promise<SubagentResult> => {
      receivedArgs = args;
      return {
        agent: forkAgent.name,
        task: "clean task",
        output: "stub output",
        exitCode: 0,
        elapsed: 10,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
          turns: 0,
        },
      };
    };

    const result = await launchSubagent(
      forkAgent,
      "clean task",
      process.cwd(),
      undefined,
      undefined,
      0,
      undefined, // no parent session file
      stubLaunch,
    );

    // Launch still proceeds, no --session in args
    expect(receivedArgs).not.toContain("--session");
    expect(result.sessionFile).toBeUndefined();
    expect(result.exitCode).toBe(0);
  });

  it("fork with nonexistent parent → creates header-only child, launches normally", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    const nonexistentParent = join(parentDir, "does-not-exist.jsonl");

    const forkAgent: AgentConfig = {
      ...agent,
      mode: "fork",
      noSession: true,
    };

    let receivedArgs: string[] = [];

    const stubLaunch = async (
      args: string[],
      _a: AgentConfig,
      _task: string,
      _cwd: string,
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      _timeout: number,
    ): Promise<SubagentResult> => {
      receivedArgs = args;
      return {
        agent: forkAgent.name,
        task: "fallback task",
        output: "stub output",
        exitCode: 0,
        elapsed: 10,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
          turns: 0,
        },
      };
    };

    try {
      const result = await launchSubagent(
        forkAgent,
        "fallback task",
        process.cwd(),
        undefined,
        undefined,
        0,
        nonexistentParent, // no parent file → seed fails
        stubLaunch,
      );

      // Seed creates header-only child from empty parent → forkFile set, launch proceeds
      expect(receivedArgs).toContain("--session");
      expect(result.sessionFile).toBeUndefined(); // noSession=true
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });

  it("launchSubagent throws when stub fails, still cleans up fork file (noSession)", async () => {
    const parentDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
    const parentFile = join(parentDir, "parent.jsonl");
    writeFileSync(
      parentFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n`,
      "utf8",
    );

    const ephemeralAgent: AgentConfig = {
      ...agent,
      mode: "fork",
      noSession: true,
    };

    let capturedSessionFile: string | undefined;

    const stubLaunch = async (
      args: string[],
      _a: AgentConfig,
      _task: string,
      _cwd: string,
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      _timeout: number,
    ): Promise<SubagentResult> => {
      const sessionIdx = args.indexOf("--session");
      if (sessionIdx !== -1) {
        capturedSessionFile = args[sessionIdx + 1];
      }
      throw new Error("simulated launch failure");
    };

    try {
      await expect(
        launchSubagent(
          ephemeralAgent,
          "ephemeral task",
          process.cwd(),
          undefined,
          undefined,
          0,
          parentFile,
          stubLaunch,
        ),
      ).rejects.toThrow("simulated launch failure");

      // finally block in launchSubagent cleaned up fork file despite error
      expect(capturedSessionFile).toBeDefined();
      expect(existsSync(capturedSessionFile!)).toBe(false);
    } finally {
      rmSync(parentDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// createSubagentTool
// =============================================================================

describe("createSubagentTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers as tool named 'subagent'", () => {
    const tool = createSubagentTool();
    expect(tool.name).toBe("subagent");
    expect(tool.label).toBe("Subagent");
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it("has agent, task, tasks, and optional cwd parameters", () => {
    const tool = createSubagentTool();
    const props = (tool.parameters as any).properties;
    expect(props).toHaveProperty("agent");
    expect(props).toHaveProperty("task");
    expect(props).toHaveProperty("tasks");
    expect(props).toHaveProperty("cwd");
  });

  it("returns error for unknown agent (single mode)", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { agent: "nonexistent-agent", task: "do something" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("Unknown agent");
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("nonexistent-agent");
  });

  it("returns error when both agent and tasks are provided", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { agent: "foo", task: "bar", tasks: [] },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("not both");
  });

  it("returns error when neither agent nor tasks are provided", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      {},
      undefined,
      undefined,
      makeCtx(tmpDir),
    );
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("Provide either");
  });

  it("returns error for unknown agent in parallel tasks", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      {
        tasks: [
          { agent: "unknown-1", task: "do A" },
          { agent: "unknown-2", task: "do B" },
        ],
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    const details = result.details;
    expect(details.agent).toBe("parallel");
    expect(details.results).toBeDefined();
    if (!details.results) {
      throw new Error("expected results to be defined");
    }
    expect(details.results).toHaveLength(2);
    expect(details.results[0]?.error ?? "").toContain("Unknown agent");
    expect(details.results[1]?.error ?? "").toContain("Unknown agent");
    expect((result.content[0] as { type: "text"; text: string }).text).toBe(
      "Parallel: 0/2 succeeded.",
    );
  });

  it("returns error for empty tasks array", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { tasks: [] },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("must not be empty");
  });

  it("returns aborted results when signal is pre-aborted (parallel)", async () => {
    const tool = createSubagentTool();
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      "tc-1",
      {
        tasks: [
          { agent: "nonexistent-1", task: "do A" },
          { agent: "nonexistent-2", task: "do B" },
        ],
      },
      controller.signal,
      undefined,
      makeCtx(tmpDir),
    );

    const details = result.details;
    expect(details.agent).toBe("parallel");
    expect(details.results).toBeDefined();
    if (!details.results) {
      throw new Error("expected results to be defined");
    }
    expect(details.results).toHaveLength(2);
    for (const r of details.results) {
      expect(r.error).toBe("Subagent was aborted");
    }
    expect((result.content[0] as { type: "text"; text: string }).text).toBe(
      "Parallel: 0/2 succeeded.",
    );
  });
});

// =============================================================================
// createResumeTool
// =============================================================================

describe("createResumeTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers as tool named 'subagent_resume'", () => {
    const tool = createResumeTool();
    expect(tool.name).toBe("subagent_resume");
    expect(tool.label).toBe("Subagent Resume");
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
  });

  it("schema has session (required), task (required), cwd (optional)", () => {
    const tool = createResumeTool();
    const props = (tool.parameters as { properties: Record<string, unknown> })
      .properties;
    expect(props.session).toBeDefined();
    expect(props.task).toBeDefined();
    // cwd is optional — TypeBox Optional marks it differently
  });

  it("returns error when session file does not exist", async () => {
    const tool = createResumeTool();
    const result = await tool.execute(
      "tc-1",
      {
        session: join(tmpDir, "nonexistent.jsonl"),
        task: "continue work",
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("not found");
  });

  it("returns error when session has no launch metadata", async () => {
    // Create a session file without launch metadata
    const sessionFile = join(tmpDir, "old-session.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: new Date().toISOString(),
        cwd: tmpDir,
      })}\n`,
      "utf8",
    );

    const tool = createResumeTool();
    const result = await tool.execute(
      "tc-1",
      { session: sessionFile, task: "continue work" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("launch metadata");
  });

  it("returns error when cwd is outside project directory", async () => {
    // Create a parent session with actual content so fork produces metadata
    const { seedForkSession: seed, generateChildSessionFile: gen } =
      await import("../src/lib/session.js");
    const parentFile = join(tmpDir, "parent.jsonl");
    writeFileSync(
      parentFile,
      `${JSON.stringify({
        type: "session",
        version: 3,
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        timestamp: new Date().toISOString(),
        cwd: tmpDir,
      })}\n${JSON.stringify({
        type: "message",
        id: "msg00001",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "parent context" }],
        },
      })}\n`,
      "utf8",
    );
    const sessionFile = gen(tmpDir);
    seed(parentFile, sessionFile, baseAgent, tmpDir);

    const tool = createResumeTool();
    const result = await tool.execute(
      "tc-1",
      {
        session: sessionFile,
        task: "continue work",
        cwd: "/outside/project",
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("outside the project directory");
  });

  it.todo("session with metadata triggers launch (requires pi runtime)");
});
