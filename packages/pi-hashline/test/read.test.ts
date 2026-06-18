import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeFileHash } from "../src/format";
import type { ReadToolDetails } from "../src/read";
import { createReadTool } from "../src/read";
import { InMemorySnapshotStore } from "../src/snapshots";

let testDir: string;
let snapshots: InMemorySnapshotStore;

function createMockContext(cwd: string): ExtensionContext {
  return {
    cwd,
    ui: {} as any,
    mode: "tui" as any,
    hasUI: false,
    sessionManager: {} as any,
    modelRegistry: {} as any,
    model: undefined,
    isIdle: () => true,
    isProjectTrusted: () => false,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
  };
}

beforeEach(async () => {
  snapshots = new InMemorySnapshotStore();
  const prefix = join(tmpdir(), "pi-hashline-test-");
  testDir = await mkdir(join(prefix, Date.now().toString()), {
    recursive: true,
  }).then((dir) => dir ?? join(prefix, Date.now().toString()));
});

afterEach(async () => {
  try {
    const { rm } = await import("node:fs/promises");
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function writeTestFile(
  relPath: string,
  content: string,
): Promise<string> {
  const absPath = join(testDir, relPath);
  await mkdir(resolve(absPath, ".."), { recursive: true });
  await writeFile(absPath, content, "utf-8");
  return absPath;
}

describe("read tool (hashline)", () => {
  it("output starts with ¶PATH#TAG header", async () => {
    await writeTestFile("foo.ts", "const x = 42;\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);
    const result = await tool.execute(
      "id1",
      { path: "foo.ts" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/^¶foo\.ts#[0-9A-F]{4}\n/);
  });

  it("reading the same file twice produces the same tag", async () => {
    await writeTestFile("bar.ts", "hello\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const r1 = await tool.execute(
      "id1",
      { path: "bar.ts" },
      undefined,
      undefined,
      ctx,
    );
    const r2 = await tool.execute(
      "id2",
      { path: "bar.ts" },
      undefined,
      undefined,
      ctx,
    );

    const details1 = r1.details as ReadToolDetails;
    const details2 = r2.details as ReadToolDetails;
    expect(details1.fileHash).toBe(details2.fileHash);
  });

  it("reading after external change produces different tag", async () => {
    const absPath = await writeTestFile("baz.ts", "v1\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const r1 = await tool.execute(
      "id1",
      { path: "baz.ts" },
      undefined,
      undefined,
      ctx,
    );
    const details1 = r1.details as ReadToolDetails;

    await writeFile(absPath, "v2\n", "utf-8");

    const r2 = await tool.execute(
      "id2",
      { path: "baz.ts" },
      undefined,
      undefined,
      ctx,
    );
    const details2 = r2.details as ReadToolDetails;

    expect(details1.fileHash).not.toBe(details2.fileHash);
  });

  it("formats output as numbered lines", async () => {
    await writeTestFile("nums.ts", "line1\nline2\nline3\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "nums.ts" },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("1:line1");
    expect(text).toContain("2:line2");
    expect(text).toContain("3:line3");
  });

  it("offset skips lines", async () => {
    await writeTestFile("skip.ts", "a\nb\nc\nd\ne\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "skip.ts", offset: 3 },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).not.toContain("1:a");
    expect(text).not.toContain("2:b");
    expect(text).toContain("3:c");
    expect(text).toContain("4:d");
  });

  it("limit caps the number of lines", async () => {
    await writeTestFile("limit.ts", "a\nb\nc\nd\ne\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "limit.ts", offset: 2, limit: 2 },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(text).toContain("2:b");
    expect(text).toContain("3:c");
    expect(text).not.toContain("1:a");
    expect(text).not.toContain("4:d");
    expect(text).not.toContain("5:e");
  });

  it("snapshot is recorded in the store", async () => {
    await writeTestFile("record.ts", "hello world\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute("id1", { path: "record.ts" }, undefined, undefined, ctx);

    const head = snapshots.head(resolve(testDir, "record.ts"));
    expect(head).not.toBeNull();
    expect(head!.text).toBe("hello world\n");

    const details = (
      await tool.execute(
        "id2",
        { path: "record.ts" },
        undefined,
        undefined,
        ctx,
      )
    ).details as ReadToolDetails;
    expect(head!.hash).toBe(details.fileHash);
  });

  it("non-existent file returns error", async () => {
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "nonexistent.ts" },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as ReadToolDetails;
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/Cannot read file/);
    expect(details.fileHash).toBe("");
  });

  it("details include totalLines, totalBytes, fileHash, header", async () => {
    await writeTestFile("details.ts", "line1\nline2\nline3\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "details.ts" },
      undefined,
      undefined,
      ctx,
    );
    const details = result.details as ReadToolDetails;

    expect(details.totalLines).toBe(3);
    expect(details.totalBytes).toBeGreaterThan(0);
    expect(details.fileHash).toMatch(/^[0-9A-F]{4}$/);
    expect(details.header).toBe(`¶details.ts#${details.fileHash}`);
    expect(details.truncated).toBe(false);
  });

  it("header uses display-relative path", async () => {
    await writeTestFile("sub/deep.ts", "x\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "sub/deep.ts" },
      undefined,
      undefined,
      ctx,
    );
    const details = result.details as ReadToolDetails;

    expect(details.header).toMatch(/^¶sub\/deep\.ts#[0-9A-F]{4}$/);
  });

  it("CRLF files are normalized for hashing", async () => {
    await writeTestFile("crlf.ts", "line1\r\nline2\r\n");
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "crlf.ts" },
      undefined,
      undefined,
      ctx,
    );
    const details = result.details as ReadToolDetails;
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(details.fileHash).toBe(computeFileHash("line1\nline2\n"));
    expect(text).toContain("1:line1");
    expect(text).toContain("2:line2");
  });

  it("large files get truncation warning", async () => {
    const longLine = `${"x".repeat(100)}\n`;
    const lines = longLine.repeat(700);
    await writeTestFile("large.ts", lines);

    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "large.ts" },
      undefined,
      undefined,
      ctx,
    );
    const details = result.details as ReadToolDetails;
    const text = (result.content[0] as { type: "text"; text: string }).text;

    expect(details.truncated).toBe(true);
    expect(text).toMatch(/truncated at 50KB/);
  });

  it("image files delegate to native read", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
      0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    const absPath = join(testDir, "test.png");
    await writeFile(absPath, png);

    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "test.png" },
      undefined,
      undefined,
      ctx,
    );

    // Delegation succeeded — native read returns content.
    expect(result.content.length).toBeGreaterThan(0);
    // No hashline snapshot recorded for delegated reads.
    expect(snapshots.head(absPath)).toBeNull();
  });

  it("SVG files delegate to native read", async () => {
    await writeTestFile(
      "icon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>\n',
    );
    const tool = createReadTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "icon.svg" },
      undefined,
      undefined,
      ctx,
    );

    // Delegation succeeded — native read handles SVG.
    expect(result.content.length).toBeGreaterThan(0);
  });
});
