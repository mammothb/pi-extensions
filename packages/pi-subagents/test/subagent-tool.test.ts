import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSubagentTool } from "../src/subagent-tool.js";
import { makeCtx } from "./helpers.js";

// ===========================================================================
// createSubagentTool — extended tests (non-duplicate of launch.test.ts)
// ===========================================================================

describe("createSubagentTool — extended", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-subagents-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Single mode — agent/task required edge cases ──────────────────────

  it("returns error when agent is empty string", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { agent: "", task: "do something" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("agent is required");
    expect(result.details.exitCode).toBe(1);
  });

  it("returns error when task is empty string", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { agent: "some-agent", task: "" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("task is required");
  });

  it("returns error when only task is provided (agent missing)", async () => {
    const tool = createSubagentTool();
    // Only task → hasSingle true, but agent undefined → falls through to
    // executeSingle which checks agentName first
    const result = await tool.execute(
      "tc-1",
      { task: "do something" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("agent is required");
  });

  it("returns error when only agent is provided (task missing)", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { agent: "some-agent" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("task is required");
  });

  // ── validateCwd via parallel mode (cwd checked before agent discovery) ─

  it("rejects cwd outside project directory (parallel mode)", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-cwd",
      {
        tasks: [{ agent: "any-agent", task: "do something" }],
        cwd: "/etc",
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).toContain("outside the project directory");
  });

  it("accepts cwd matching project directory (parallel mode)", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-cwd-ok",
      {
        tasks: [{ agent: "any-agent", task: "do something" }],
        cwd: tmpDir,
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    // cwd validation passes, falls through to agent lookup which fails
    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).not.toContain("outside the project directory");
  });

  it("accepts cwd that is subdirectory of project (parallel mode)", async () => {
    const tool = createSubagentTool();
    const subDir = join(tmpDir, "sub");
    mkdirSync(subDir, { recursive: true });

    const result = await tool.execute(
      "tc-cwd-sub",
      {
        tasks: [{ agent: "any-agent", task: "do something" }],
        cwd: subDir,
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(
      (result.content[0] as { type: "text"; text: string }).text,
    ).not.toContain("outside the project directory");
  });

  // ── error details structure ───────────────────────────────────────────

  it("includes agent name in error details for single mode failures", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { agent: "my-agent", task: "do stuff" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(result.details.agent).toBe("my-agent");
    expect(result.details.task).toBe("do stuff");
    expect(result.details.error).toBeDefined();
  });

  it("returns structured tokens and elapsed for error results", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      { agent: "agent-x", task: "task-y" },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(result.details.exitCode).toBe(1);
    expect(result.details.tokens).toBeDefined();
    expect(result.details.tokens.input).toBe(0);
    expect(result.details.tokens.output).toBe(0);
    expect(result.details.tokens.total).toBe(0);
    expect(result.details.tokens.turns).toBe(0);
    expect(result.details.elapsed).toBe(0);
  });

  it("reports exit code of 1 when no agents succeed (parallel)", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      {
        tasks: [{ agent: "nonexistent", task: "fail" }],
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect(result.details.exitCode).toBe(1);
  });

  // ── summary text forms ────────────────────────────────────────────────

  it("shows 0/1 succeeded in summary for one failed task (parallel)", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      {
        tasks: [{ agent: "nonexistent", task: "fail" }],
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect((result.content[0] as { type: "text"; text: string }).text).toBe(
      "Parallel: 0/1 succeeded.",
    );
  });

  it("shows 0/3 succeeded for three failed tasks (parallel)", async () => {
    const tool = createSubagentTool();
    const result = await tool.execute(
      "tc-1",
      {
        tasks: [
          { agent: "u1", task: "a" },
          { agent: "u2", task: "b" },
          { agent: "u3", task: "c" },
        ],
      },
      undefined,
      undefined,
      makeCtx(tmpDir),
    );

    expect((result.content[0] as { type: "text"; text: string }).text).toBe(
      "Parallel: 0/3 succeeded.",
    );
  });
});
