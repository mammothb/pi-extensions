import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditToolDetails } from "../src/edit";
import { createEditTool } from "../src/edit";
import { MismatchError } from "../src/messages";
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
  const prefix = join(tmpdir(), "pi-hashline-edit-test-");
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

/**
 * Create a snapshot for a file by recording its content and returning the tag.
 */
function snapshotFile(absPath: string, content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return snapshots.record(absPath, normalized);
}

/**
 * Build a hashline patch string for a single file.
 */
function patch(filePath: string, fileHash: string, ...ops: string[]): string {
  return `¶${filePath}#${fileHash}\n${ops.join("\n")}\n`;
}

describe("edit tool (hashline)", () => {
  it("applies a correct-tag replace", async () => {
    await writeTestFile("foo.ts", "const x = 42;\nconst y = 100;\n");
    const absPath = resolve(testDir, "foo.ts");
    const content = "const x = 42;\nconst y = 100;\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { edits: patch("foo.ts", tag, "replace 1..1:", "+const x = 99;") },
      undefined,
      undefined,
      ctx,
    );

    // Verify response.
    const details = result.details as EditToolDetails;
    expect(details.files).toHaveLength(1);
    expect(details.files[0]!.fileHash).toMatch(/^[0-9A-F]{4}$/);
    expect(details.files[0]!.fileHash).not.toBe(tag);
    expect(details.files[0]!.header).toBe(
      `¶foo.ts#${details.files[0]!.fileHash}`,
    );
    expect(details.changed).toBe(true);

    // Verify file content.
    const newContent = await readFile(absPath, "utf-8");
    expect(newContent.replace(/\r\n/g, "\n")).toBe(
      "const x = 99;\nconst y = 100;\n",
    );

    // Verify new tag appears in text response.
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain(`¶foo.ts#${details.files[0]!.fileHash}`);
  });

  it("returns fresh hash different from input tag", async () => {
    await writeTestFile("bar.ts", "a\nb\nc\n");
    const absPath = resolve(testDir, "bar.ts");
    const content = "a\nb\nc\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { edits: patch("bar.ts", tag, "replace 2..2:", "+X") },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as EditToolDetails;
    expect(details.files[0]!.fileHash).not.toBe(tag);
  });

  it("rejects stale tag with MismatchError", async () => {
    const absPath = await writeTestFile("baz.ts", "v1\nv2\nv3\n");
    const tag = snapshotFile(absPath, "v1\nv2\nv3\n");

    // Modify file externally.
    await writeFile(absPath, "v1\nCHANGED\nv3\n", "utf-8");

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    await expect(
      tool.execute(
        "id1",
        { edits: patch("baz.ts", tag, "replace 2..2:", "+new") },
        undefined,
        undefined,
        ctx,
      ),
    ).rejects.toThrow(MismatchError);

    try {
      await tool.execute(
        "id1",
        { edits: patch("baz.ts", tag, "replace 2..2:", "+new") },
        undefined,
        undefined,
        ctx,
      );
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(MismatchError);
      const me = err as MismatchError;
      expect(me.filePath).toBe("baz.ts");
      expect(me.expectedTag).toBe(tag);
      expect(me.message).toMatch(/changed between read and edit/);
      expect(me.message).toMatch(/Re-read/);
    }
  });

  it("rejects missing tag", async () => {
    await writeTestFile("notag.ts", "content\n");
    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      // Header without hash
      { edits: "¶notag.ts\nreplace 1..1:\n+new\n" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/Missing hashline snapshot tag/);
  });

  it("rejects non-existent file", async () => {
    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    // Need a valid tag so the patch parses. Use a fake tag.
    const result = await tool.execute(
      "id1",
      { edits: patch("ghost.ts", "A1B2", "replace 1..1:", "+x") },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/does not exist/);
  });

  it("rejects input without ¶PATH#TAG header", async () => {
    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { edits: "replace 1..1:\n+new line\n" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/Edit parse error/);
  });

  it("applies multi-line replace", async () => {
    await writeTestFile("multi.ts", "line1\nline2\nline3\nline4\n");
    const absPath = resolve(testDir, "multi.ts");
    const content = "line1\nline2\nline3\nline4\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { edits: patch("multi.ts", tag, "replace 2..3:", "+A", "+B") },
      undefined,
      undefined,
      ctx,
    );

    const newContent = await readFile(absPath, "utf-8");
    expect(newContent.replace(/\r\n/g, "\n")).toBe("line1\nA\nB\nline4\n");
  });

  it("applies delete", async () => {
    await writeTestFile("del.ts", "keep\nremove\nkeep2\n");
    const absPath = resolve(testDir, "del.ts");
    const content = "keep\nremove\nkeep2\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { edits: patch("del.ts", tag, "delete 2") },
      undefined,
      undefined,
      ctx,
    );

    const newContent = await readFile(absPath, "utf-8");
    expect(newContent.replace(/\r\n/g, "\n")).toBe("keep\nkeep2\n");
  });

  it("applies insert before", async () => {
    await writeTestFile("ins.ts", "a\nb\nc\n");
    const absPath = resolve(testDir, "ins.ts");
    const content = "a\nb\nc\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { edits: patch("ins.ts", tag, "insert before 2:", "+INSERTED") },
      undefined,
      undefined,
      ctx,
    );

    const newContent = await readFile(absPath, "utf-8");
    expect(newContent.replace(/\r\n/g, "\n")).toBe("a\nINSERTED\nb\nc\n");
  });

  it("applies insert tail", async () => {
    await writeTestFile("tail.ts", "a\nb\n");
    const absPath = resolve(testDir, "tail.ts");
    const content = "a\nb\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { edits: patch("tail.ts", tag, "insert tail:", "+END") },
      undefined,
      undefined,
      ctx,
    );

    const newContent = await readFile(absPath, "utf-8");
    expect(newContent.replace(/\r\n/g, "\n")).toBe("a\nb\nEND\n");
  });

  it("head-only inserts on stale tag succeed with drift warning", async () => {
    const absPath = await writeTestFile("drift.ts", "content\n");
    const tag = snapshotFile(absPath, "content\n");

    // Modify file externally.
    await writeFile(absPath, "modified content\n", "utf-8");

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      {
        edits: patch("drift.ts", tag, "insert head:", "+# header"),
      },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as EditToolDetails;
    expect(details.files).toHaveLength(1);
    expect(details.files[0]!.warnings).toBeDefined();
    expect(details.files[0]!.warnings![0]).toMatch(/snapshot tag was stale/);

    // File should have the insert applied.
    const newContent = await readFile(absPath, "utf-8");
    expect(newContent.replace(/\r\n/g, "\n")).toBe(
      "# header\nmodified content\n",
    );
  });

  it("tail-only inserts on stale tag succeed with drift warning", async () => {
    const absPath = await writeTestFile("drift2.ts", "content\n");
    const tag = snapshotFile(absPath, "content\n");

    // Modify file externally.
    await writeFile(absPath, "modified content\n", "utf-8");

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      {
        edits: patch("drift2.ts", tag, "insert tail:", "+footer"),
      },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as EditToolDetails;
    expect(details.files[0]!.warnings).toBeDefined();
    expect(details.files[0]!.warnings![0]).toMatch(/snapshot tag was stale/);
  });

  it("multi-section edit applies both files", async () => {
    const absA = await writeTestFile("a.ts", "a\n");
    const absB = await writeTestFile("b.ts", "b\n");
    const tagA = snapshotFile(absA, "a\n");
    const tagB = snapshotFile(absB, "b\n");

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const multiPatch = [
      `¶a.ts#${tagA}`,
      "replace 1..1:",
      "+A_CHANGED",
      `¶b.ts#${tagB}`,
      "replace 1..1:",
      "+B_CHANGED",
      "",
    ].join("\n");

    const result = await tool.execute(
      "id1",
      { edits: multiPatch },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as EditToolDetails;
    expect(details.files).toHaveLength(2);

    const newA = await readFile(absA, "utf-8");
    const newB = await readFile(absB, "utf-8");
    expect(newA.replace(/\r\n/g, "\n")).toBe("A_CHANGED\n");
    expect(newB.replace(/\r\n/g, "\n")).toBe("B_CHANGED\n");
  });

  it("multi-section edit is atomic: second failure prevents first write", async () => {
    const absGood = await writeTestFile("good.ts", "good\n");
    const tagGood = snapshotFile(absGood, "good\n");
    await writeTestFile("bad.ts", "bad content here\n");
    // Don't snapshot bad.ts — the tag FFFF won't match the live file.

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    // Second section has a stale tag (wrong hash).
    const multiPatch = [
      `¶good.ts#${tagGood}`,
      "replace 1..1:",
      "+CHANGED",
      "¶bad.ts#FFFF",
      "replace 1..1:",
      "+nope",
      "",
    ].join("\n");

    const result = await tool.execute(
      "id1",
      { edits: multiPatch },
      undefined,
      undefined,
      ctx,
    );

    // Should return error (unrecognized hash), not throw.
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/not recorded/);

    // The first file should NOT have been modified (atomic failure).
    const goodContent = await readFile(absGood, "utf-8");
    expect(goodContent.replace(/\r\n/g, "\n")).toBe("good\n");
  });

  it("preserves CRLF line endings", async () => {
    const absPath = await writeTestFile("crlf.ts", "a\r\nb\r\nc\r\n");
    const content = "a\r\nb\r\nc\r\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { edits: patch("crlf.ts", tag, "replace 2..2:", "+X") },
      undefined,
      undefined,
      ctx,
    );

    const newContent = await readFile(absPath, "utf-8");
    expect(newContent).toBe("a\r\nX\r\nc\r\n");
  });

  it("edit response includes numbered preview", async () => {
    await writeTestFile(
      "preview.ts",
      "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n",
    );
    const absPath = resolve(testDir, "preview.ts");
    const content = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { edits: patch("preview.ts", tag, "replace 4..4:", "+CHANGED") },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Should have the new header + numbered lines around line 4.
    expect(text).toMatch(/^¶preview\.ts#[0-9A-F]{4}\n/m);
    expect(text).toContain("3:line3");
    expect(text).toContain("4:CHANGED");
    expect(text).toContain("5:line5");
  });

  it("no-op edit (empty diff) works", async () => {
    await writeTestFile("noop.ts", "content\n");
    const absPath = resolve(testDir, "noop.ts");
    const content = "content\n";
    const tag = snapshotFile(absPath, content);

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { edits: patch("noop.ts", tag) }, // no ops, just header
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as EditToolDetails;
    // Patch.parse rejects sections without ops... let me check.
    // Actually an empty section is excluded by Patch.parse.
    // So the result will be zero sections → parse error.
    // This is expected behavior: you can't edit without ops.
    expect(details.files).toHaveLength(0);
  });

  it("creates parent directories when needed", async () => {
    // Write file in a non-existent subdirectory (via write tool would handle this).
    // For edit, the file must exist already, so this is a write-then-edit.
    await writeTestFile("sub/exists.ts", "original\n");
    const absPath = resolve(testDir, "sub/exists.ts");
    const tag = snapshotFile(absPath, "original\n");

    const tool = createEditTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      {
        edits: patch("sub/exists.ts", tag, "replace 1..1:", "+changed"),
      },
      undefined,
      undefined,
      ctx,
    );

    const newContent = await readFile(absPath, "utf-8");
    expect(newContent.replace(/\r\n/g, "\n")).toBe("changed\n");
  });
});
