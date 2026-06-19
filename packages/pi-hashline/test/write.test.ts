import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeFileHash } from "../src/lib/hashline/format.js";
import { InMemorySnapshotStore } from "../src/lib/hashline/snapshots.js";
import type { WriteToolDetails } from "../src/schema.js";
import { createWriteTool } from "../src/write.js";

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
  const prefix = join(tmpdir(), "pi-hashline-write-test-");
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

describe("write tool (hashline)", () => {
  it("result includes ¶PATH#TAG header", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "new.ts", content: "const x = 42;\n" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/^¶new\.ts#[0-9A-F]{6}\n/);

    const details = result.details as WriteToolDetails;
    expect(details.fileHash).toMatch(/^[0-9A-F]{6}$/);
    expect(details.header).toBe(`¶new.ts#${details.fileHash}`);
  });

  it("writes content to disk", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { path: "file.ts", content: "hello world\n" },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "file.ts");
    const content = await readFile(absPath, "utf-8");
    expect(content).toBe("hello world\n");
  });

  it("creates parent directories automatically", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { path: "deep/nested/file.ts", content: "nested\n" },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "deep/nested/file.ts");
    const content = await readFile(absPath, "utf-8");
    expect(content).toBe("nested\n");
  });

  it("records snapshot so subsequent edit can use the tag", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "edit-me.ts", content: "original\n" },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as WriteToolDetails;
    const tag = details.fileHash;

    // Snapshot should be in the store.
    const absPath = resolve(testDir, "edit-me.ts");
    const head = snapshots.head(absPath);
    expect(head).not.toBeNull();
    expect(head!.hash).toBe(tag);

    // The tag should match a fresh compute of the written file.
    const onDisk = await readFile(absPath, "utf-8");
    const expectedHash = computeFileHash(onDisk.replace(/\r\n/g, "\n"));
    expect(tag).toBe(expectedHash);
  });

  it("overwriting an existing file updates the snapshot", async () => {
    // Write initial file.
    const absPath = resolve(testDir, "overwrite.ts");
    await writeFile(absPath, "version 1\n", "utf-8");

    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const r1 = await tool.execute(
      "id1",
      { path: "overwrite.ts", content: "version 1\n" },
      undefined,
      undefined,
      ctx,
    );
    const tag1 = (r1.details as WriteToolDetails).fileHash;

    // Overwrite with different content.
    const r2 = await tool.execute(
      "id2",
      { path: "overwrite.ts", content: "version 2\n" },
      undefined,
      undefined,
      ctx,
    );
    const tag2 = (r2.details as WriteToolDetails).fileHash;

    // Tags should differ.
    expect(tag1).not.toBe(tag2);

    // Head snapshot should be the latest version.
    const head = snapshots.head(absPath);
    expect(head!.hash).toBe(tag2);
    expect(head!.text).toBe("version 2\n");
  });

  it("tag changes on second write with different content", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const r1 = await tool.execute(
      "id1",
      { path: "tag-change.ts", content: "a\n" },
      undefined,
      undefined,
      ctx,
    );
    const r2 = await tool.execute(
      "id2",
      { path: "tag-change.ts", content: "b\n" },
      undefined,
      undefined,
      ctx,
    );

    const tag1 = (r1.details as WriteToolDetails).fileHash;
    const tag2 = (r2.details as WriteToolDetails).fileHash;
    expect(tag1).not.toBe(tag2);
  });

  it("output includes numbered lines like read tool", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      {
        path: "numbered.ts",
        content: "line1\nline2\nline3\n",
      },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("1:line1");
    expect(text).toContain("2:line2");
    expect(text).toContain("3:line3");
  });

  it("details include totalLines", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "count.ts", content: "a\nb\nc\n" },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as WriteToolDetails;
    expect(details.totalLines).toBe(3);
  });

  it("handles empty content", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "empty.ts", content: "" },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as WriteToolDetails;
    expect(details.totalLines).toBe(0);
    expect(details.fileHash).toMatch(/^[0-9A-F]{6}$/);

    const absPath = resolve(testDir, "empty.ts");
    const content = await readFile(absPath, "utf-8");
    expect(content).toBe("");
  });

  it("handles content without trailing newline", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "notrail.ts", content: "single line" },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as WriteToolDetails;
    expect(details.totalLines).toBe(1);

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("1:single line");
  });

  // -- Prefix stripping integration tests -------------------------------

  it("strips hashline prefixes from content before writing", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    // Content with hashline line-number prefixes (no header).
    const content = "1:hello\n2:world\n";
    await tool.execute(
      "id1",
      { path: "stripped.ts", content },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "stripped.ts");
    const onDisk = await readFile(absPath, "utf-8");
    expect(onDisk).toBe("hello\nworld\n");
  });

  it("stripped content has correct hash and snapshot", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "hash-snap.ts", content: "1:a\n2:b\n" },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as WriteToolDetails;
    const absPath = resolve(testDir, "hash-snap.ts");

    // Snapshot should be from stripped content.
    const head = snapshots.head(absPath);
    expect(head).not.toBeNull();
    expect(head!.text).toBe("a\nb\n");

    // Hash should match stripped content.
    const onDisk = await readFile(absPath, "utf-8");
    const expectedHash = computeFileHash(onDisk.replace(/\r\n/g, "\n"));
    expect(details.fileHash).toBe(expectedHash);
  });

  it("appends auto-stripped note when stripping occurred", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "note.ts", content: "1:x\n" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain(
      "Note: auto-stripped hashline display prefixes from content before writing.",
    );
  });

  it("does NOT strip when content has no hashline prefixes", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const content = "plain old text\nno prefixes here\n";
    await tool.execute(
      "id1",
      { path: "nostrip.ts", content },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "nostrip.ts");
    const onDisk = await readFile(absPath, "utf-8");
    expect(onDisk).toBe(content);
  });

  it("does NOT attach note when no stripping occurred", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { path: "nonote.ts", content: "clean content\n" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).not.toContain("auto-stripped");
  });

  it("handles content with hashline header + numbered lines", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const content = "¶src/foo.ts#1A2B00\n1:first line\n2:second line\n";
    await tool.execute(
      "id1",
      { path: "header-plus.ts", content },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "header-plus.ts");
    const onDisk = await readFile(absPath, "utf-8");
    expect(onDisk).toBe("first line\nsecond line\n");
  });

  it("handles content with only numbered lines (no header)", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    const content = "1:line one\n2:line two\n3:line three\n";
    await tool.execute(
      "id1",
      { path: "numbered-only.ts", content },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "numbered-only.ts");
    const onDisk = await readFile(absPath, "utf-8");
    expect(onDisk).toBe("line one\nline two\nline three\n");
  });

  it("strips via loose-header fallback when header is malformed", async () => {
    const tool = createWriteTool(snapshots);
    const ctx = createMockContext(testDir);

    // Malformed header: non-hex characters in hash (strict HL_HEADER_RE
    // requires hex chars). The loose-header fallback catches it.
    const content =
      "¶path/to/file.ts#EXTRA\n1:actual content\n2:more content\n";
    await tool.execute(
      "id1",
      { path: "loose.ts", content },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "loose.ts");
    const onDisk = await readFile(absPath, "utf-8");
    expect(onDisk).toBe("actual content\nmore content\n");
  });
});
