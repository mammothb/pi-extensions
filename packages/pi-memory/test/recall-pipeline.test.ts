import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRecallPipeline } from "../src/lib/recall/recall-pipeline.js";

describe("runRecallPipeline", () => {
  let tmpDir: string;
  let sessionFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-memory-test-"));
    sessionFile = join(tmpDir, "session.jsonl");
    // Write a minimal session with a few entries
    const header = {
      type: "session",
      version: 3,
      id: "test-session",
      timestamp: new Date().toISOString(),
      cwd: "/tmp",
    };
    const messages = [
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: new Date().toISOString(),
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: new Date().toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi there" }],
        },
      },
    ];
    writeFileSync(
      sessionFile,
      `${JSON.stringify(header)}\n${messages.map((m) => JSON.stringify(m)).join("\n")}\n`,
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes scope prefix for scope:all", () => {
    const result = runRecallPipeline({
      sessionFile,
      query: "hello",
      scope: "all",
      page: 1,
    });
    expect(result.text).toContain("Scope: all");
  });

  it("omits scope prefix for default (lineage) scope", () => {
    const result = runRecallPipeline({
      sessionFile,
      query: undefined,
      scope: "lineage",
      page: 1,
    });
    expect(result.text).not.toContain("Scope: all");
  });

  it("handles expand mode without query", () => {
    const result = runRecallPipeline({
      sessionFile,
      scope: "all",
      expand: [999],
    });
    expect(result.text).toContain("Cannot expand indices");
  });

  it("skips expand mode when query is present", () => {
    const result = runRecallPipeline({
      sessionFile,
      query: "hello",
      scope: "all",
      expand: [999],
    });
    // search mode runs, not expand — query takes priority
    expect(result.text).toContain("Scope: all");
    expect(result.text).toContain("hello");
  });
});
