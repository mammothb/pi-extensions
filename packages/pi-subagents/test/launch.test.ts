import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  buildCliArgs,
  getPiInvocation,
  parseJsonlStream,
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
    expect(result.messages[0].role).toBe("assistant");
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
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[1].role).toBe("toolResult");
    expect(result.messages[2].role).toBe("assistant");
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
