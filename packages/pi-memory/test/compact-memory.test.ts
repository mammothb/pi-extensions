import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompactMemoryTool } from "../src/compact-memory.js";
import { saveMemory } from "../src/lib/store.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-compact-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

describe("compact_memory tool", () => {
  const ctx = { cwd: "/test/project" } as any;

  it("registers with the expected name", () => {
    const tool = createCompactMemoryTool(baseDir);
    expect(tool.name).toBe("compact_memory");
  });

  it("reports no compaction needed when all entries are under threshold", async () => {
    saveMemory(
      "/test/project",
      { short: "brief", alsoShort: "concise" },
      baseDir,
    );
    const tool = createCompactMemoryTool(baseDir);

    const result = await tool.execute("c1", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("No compaction needed");
  });

  it("surfaces entries exceeding the default threshold (2000 chars)", async () => {
    const longValue = "x".repeat(2500);
    saveMemory("/test/project", { short: "brief", long: longValue }, baseDir);
    const tool = createCompactMemoryTool(baseDir);

    const result = await tool.execute("c2", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("long");
    expect(text).toContain("1 of 2");
    expect(text).toContain("2,500 chars");
    // The key "short" should not appear as an oversized entry header
    expect(text).not.toContain("## short");
  });

  it("respects a custom threshold", async () => {
    const big = "x".repeat(500);
    saveMemory("/test/project", { big, small: "x".repeat(50) }, baseDir);
    const tool = createCompactMemoryTool(baseDir);

    const result = await tool.execute(
      "c3",
      { threshold: 100 },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("big");
    expect(text).not.toContain("small");
  });

  it("sorts oversized entries by length (largest first)", async () => {
    saveMemory(
      "/test/project",
      {
        medium: "m".repeat(2100),
        large: "L".repeat(3000),
        small: "s".repeat(100),
      },
      baseDir,
    );
    const tool = createCompactMemoryTool(baseDir);

    const result = await tool.execute("c4", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    const largeIndex = text.indexOf("large");
    const mediumIndex = text.indexOf("medium");
    expect(largeIndex).toBeLessThan(mediumIndex);
  });

  it("includes the full value of oversized entries", async () => {
    const value = "Important content that is really long.\n".repeat(100);
    saveMemory("/test/project", { big: value }, baseDir);
    const tool = createCompactMemoryTool(baseDir);

    const result = await tool.execute("c5", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain(value);
  });

  it("shows the correct oversized char count", async () => {
    const v1 = "a".repeat(2100);
    const v2 = "b".repeat(2500);
    saveMemory("/test/project", { first: v1, second: v2 }, baseDir);
    const tool = createCompactMemoryTool(baseDir);

    const result = await tool.execute("c6", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("4,600 total oversized chars");
    expect(text).toContain("2 of 2");
  });

  it("returns usage instructions in the output", async () => {
    saveMemory("/test/project", { long: "x".repeat(3000) }, baseDir);
    const tool = createCompactMemoryTool(baseDir);

    const result = await tool.execute("c7", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("summarize");
    expect(text).toContain("call retain");
  });
});
