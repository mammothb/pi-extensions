import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { assertSuccessOrThrow, formatOutput } from "../src/format.js";
import { EvalToolError, type SubprocessResult } from "../src/types.js";

function text(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

describe("formatOutput", () => {
  it("labels stdout with (no output) when empty", () => {
    expect(formatOutput({ stdout: "", stderr: "" })).toBe(
      "STDOUT:\n(no output)",
    );
  });

  it("labels stdout content", () => {
    expect(formatOutput({ stdout: "hello", stderr: "" })).toBe(
      "STDOUT:\nhello",
    );
  });

  it("labels stderr separately", () => {
    expect(formatOutput({ stdout: "out", stderr: "err" })).toBe(
      "STDOUT:\nout\n\nSTDERR:\nerr",
    );
  });

  it("omits STDERR section when stderr is empty", () => {
    const result = formatOutput({ stdout: "out", stderr: "" });
    expect(result).toContain("STDOUT:");
    expect(result).not.toContain("STDERR:");
  });

  it("appends truncation notice when truncated is true", () => {
    expect(
      formatOutput({ stdout: "data", stderr: "", truncated: true }),
    ).toContain("[Output truncated at 1 MB]");
  });

  it("no truncation notice when truncated is false", () => {
    expect(
      formatOutput({ stdout: "data", stderr: "", truncated: false }),
    ).not.toContain("[Output truncated at 1 MB]");
  });

  it("no truncation notice when truncated is undefined", () => {
    expect(formatOutput({ stdout: "data", stderr: "" })).not.toContain(
      "[Output truncated at 1 MB]",
    );
  });

  it("appends signal notice when exitSignal is provided", () => {
    const result = formatOutput({
      stdout: "data",
      stderr: "",
      truncated: false,
      exitSignal: "SIGTERM",
    });
    expect(result).toContain("[Process killed by signal: SIGTERM]");
  });

  it("no signal notice when exitSignal is null", () => {
    const result = formatOutput({
      stdout: "data",
      stderr: "",
      truncated: false,
      exitSignal: null,
    });
    expect(result).not.toContain("Process killed by signal");
  });

  it("no signal notice when exitSignal is undefined", () => {
    const result = formatOutput({ stdout: "data", stderr: "" });
    expect(result).not.toContain("Process killed by signal");
  });
});

describe("assertSuccessOrThrow", () => {
  const success: SubprocessResult = {
    stdout: "hello",
    stderr: "",
    exitCode: 0,
    exitSignal: null,
    truncated: false,
  };

  const failure: SubprocessResult = {
    stdout: "",
    stderr: "error msg",
    exitCode: 1,
    exitSignal: null,
    truncated: false,
  };

  const truncated: SubprocessResult = {
    stdout: "x".repeat(100),
    stderr: "",
    exitCode: 0,
    exitSignal: null,
    truncated: true,
  };

  it("returns AgentToolResult on success", () => {
    const result = assertSuccessOrThrow("javascript", success);
    expect(result.details.language).toBe("javascript");
    expect(result.details.exitCode).toBe(0);
    expect(text(result)).toContain("STDOUT:\nhello");
  });

  it("throws EvalToolError on non-zero exit", () => {
    expect(() => assertSuccessOrThrow("python", failure)).toThrow(
      EvalToolError,
    );
  });

  it("error message contains STDERR content", () => {
    expect(() => assertSuccessOrThrow("python", failure)).toThrow(
      /STDERR:\nerror msg/,
    );
  });

  it("includes truncation notice in output when truncated", () => {
    const result = assertSuccessOrThrow("javascript", truncated);
    expect(text(result)).toContain("[Output truncated at 1 MB]");
  });

  it("sets details.exitCode and exitSignal from result", () => {
    const result = assertSuccessOrThrow("python", success);
    expect(result.details.exitCode).toBe(0);
    expect(result.details.exitSignal).toBeNull();
  });
});
