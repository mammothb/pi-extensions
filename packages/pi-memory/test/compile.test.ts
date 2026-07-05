import { beforeAll, describe, expect, it } from "vitest";
import { compile } from "../src/core/summarize";
import { assistantText, assistantWithToolCall, userMsg } from "./fixtures";

const mmBin = process.env.MM_CLI_PATH ?? "mm";

describe("compile", () => {
  beforeAll(() => {
    // Ensure mm binary is available
    const { execFileSync } = require("node:child_process");
    try {
      execFileSync(mmBin, ["pi"], { input: "{}", encoding: "utf-8" });
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.warn(
          `mm binary not found (${mmBin}). Set MM_CLI_PATH to the mm binary. Skipping compile tests.`,
        );
      }
    }
  });

  it("returns empty string for no messages", () => {
    const result = compile({ messages: [] });
    expect(result).toBe("");
  });

  it("produces hybrid output with header + brief transcript", () => {
    const r = compile({
      messages: [
        userMsg("Fix login bug"),
        assistantWithToolCall("Read", { path: "auth.ts" }),
        assistantText("Found the issue.\n1. Fix validation"),
      ],
    });
    expect(r).toContain("[Session Goal]");
    expect(r).toContain("Fix login bug");
    expect(r).toContain("---");
    expect(r).toContain("[user]\nFix login bug");
    expect(r).toContain('* Read "auth.ts"');
    expect(r).toContain("Found the issue.");
  });

  it("merges previous summary goals", () => {
    const r = compile({
      messages: [userMsg("New task")],
      previousSummary:
        "[Session Goal]\n- Original goal\n\n---\n\n[user]\nOriginal goal (#0)",
    });
    expect(r).toContain("- Original goal");
    expect(r).toContain("- New task");
  });

  it("appends brief transcript on merge", () => {
    const previousSummary = [
      "[Session Goal]\n- Original goal",
      "---",
      '[user]\nOriginal goal (#0)\n\n[assistant]\n* Read "old.ts" (#1)',
    ].join("\n\n");
    const r = compile({
      previousSummary,
      messages: [
        userMsg("Next step"),
        assistantWithToolCall("Read", { path: "new.ts" }),
      ],
    });
    expect(r).toContain('* Read "old.ts"');
    expect(r).toContain('* Read "new.ts"');
    expect(r).toContain("Next step");
  });

  it("wraps final output including recall note", () => {
    const r = compile({
      messages: [userMsg("check final summary wrapping")],
    });
    const maxLineLength = Math.max(...r.split("\n").map((line) => line.length));
    expect(r).toContain("mm_recall");
    expect(maxLineLength).toBeLessThanOrEqual(120);
  });

  it("appends mm_recall note", () => {
    const r = compile({
      messages: [userMsg("test")],
    });
    expect(r).toContain("mm_recall");
  });
});
