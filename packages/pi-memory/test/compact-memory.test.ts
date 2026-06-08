import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCompactMemoryTool } from "../src/compact-memory.js";
import { FileSystemBackend } from "../src/lib/backends/filesystem.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-compact-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

function makeBackend() {
  return new FileSystemBackend({ baseDir });
}

describe("compact_memory tool", () => {
  const ctx = { cwd: "/test/project" } as any;

  it("registers with the expected name", () => {
    const tool = createCompactMemoryTool(makeBackend());
    expect(tool.name).toBe("compact_memory");
  });

  it("reports no compaction needed when all entries are under threshold", async () => {
    const backend = makeBackend();
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "short",
      value: "brief",
    });
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "alsoShort",
      value: "concise",
    });

    const tool = createCompactMemoryTool(backend);

    const result = await tool.execute("c1", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("No compaction needed");
  });

  it("surfaces entries exceeding the default threshold (2000 chars)", async () => {
    const longValue = "x".repeat(2500);
    const backend = makeBackend();
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "short",
      value: "brief",
    });
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "long",
      value: longValue,
    });

    const tool = createCompactMemoryTool(backend);

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
    const backend = makeBackend();
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "big",
      value: "x".repeat(500),
    });
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "small",
      value: "x".repeat(50),
    });

    const tool = createCompactMemoryTool(backend);

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
    const backend = makeBackend();
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "medium",
      value: "m".repeat(2100),
    });
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "large",
      value: "L".repeat(3000),
    });
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "small",
      value: "s".repeat(100),
    });

    const tool = createCompactMemoryTool(backend);

    const result = await tool.execute("c4", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    const largeIndex = text.indexOf("large");
    const mediumIndex = text.indexOf("medium");
    expect(largeIndex).toBeLessThan(mediumIndex);
  });

  it("includes the full value of oversized entries", async () => {
    const value = "Important content that is really long.\n".repeat(100);
    const backend = makeBackend();
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "big",
      value,
    });

    const tool = createCompactMemoryTool(backend);

    const result = await tool.execute("c5", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain(value);
  });

  it("shows the correct oversized char count", async () => {
    const backend = makeBackend();
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "first",
      value: "a".repeat(2100),
    });
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "second",
      value: "b".repeat(2500),
    });

    const tool = createCompactMemoryTool(backend);

    const result = await tool.execute("c6", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("4,600 total oversized chars");
    expect(text).toContain("2 of 2");
  });

  it("returns usage instructions in the output", async () => {
    const backend = makeBackend();
    await backend.remember({
      scope: "project",
      cwd: "/test/project",
      key: "long",
      value: "x".repeat(3000),
    });

    const tool = createCompactMemoryTool(backend);

    const result = await tool.execute("c7", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("summarize");
    expect(text).toContain("call retain");
  });
});
