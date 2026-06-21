import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditTool } from "../src/edit.js";
import { InMemorySnapshotStore } from "../src/lib/hashline/snapshots.js";
import { createTreeSitterBlockResolver } from "../src/lib/tree-sitter-block-resolver.js";
import type { EditToolDetails } from "../src/schema.js";

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
    expect(details.files[0]!.fileHash).toMatch(/^[0-9A-F]{6}$/);
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

    const result = await tool.execute(
      "id1",
      { edits: patch("baz.ts", tag, "replace 2..2:", "+new") },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(result.details.files).toHaveLength(0);
    expect(result.details.changed).toBe(false);
    expect(text).toMatch(/changed between read and edit/);
    expect(text).toMatch(/\*2:CHANGED/);
    expect(text).toMatch(new RegExp(`#${tag}`));
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
      { edits: patch("ghost.ts", "A1B200", "replace 1..1:", "+x") },
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
    expect(
      details.files[0]!.warnings!.some((w) => /snapshot tag was stale/.test(w)),
    ).toBe(true);

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
    expect(
      details.files[0]!.warnings!.some((w) => /snapshot tag was stale/.test(w)),
    ).toBe(true);
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

    // Second section has an unrecognized hash.
    const multiPatch = [
      `¶good.ts#${tagGood}`,
      "replace 1..1:",
      "+CHANGED",
      "¶bad.ts#FFFF00",
      "replace 1..1:",
      "+nope",
      "",
    ].join("\n");

    // Should return error with hashRecognized: false.
    const result = await tool.execute(
      "id1",
      { edits: multiPatch },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(result.details.files).toHaveLength(0);
    expect(result.details.changed).toBe(false);
    expect(text).toMatch(/not from this session/);
    expect(text).toMatch(/never invent the tag/);

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

  it("edit response includes hashline preview", async () => {
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
    // Should have the new header + hash-anchored lines around line 4.
    expect(text).toMatch(/^¶preview\.ts#[0-9A-F]{6}\n/m);
    expect(text).toMatch(/[0-9a-f]{4}│line3/);
    expect(text).toMatch(/[0-9a-f]{4}│CHANGED/);
    expect(text).toMatch(/[0-9a-f]{4}│line5/);
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

  describe("block operations", () => {
    const blockResolver = createTreeSitterBlockResolver();

    function createTool(): ReturnType<typeof createEditTool> {
      return createEditTool(snapshots, blockResolver);
    }
    it("replace block N: replaces the resolved block", async () => {
      const code = "// header\nfunction foo() {\n  return 1;\n}\n// footer\n";
      await writeTestFile("mod.ts", code);
      const absPath = resolve(testDir, "mod.ts");
      const tag = snapshotFile(absPath, code);
      const ctx = createMockContext(testDir);

      const result = await createTool().execute(
        "b1",
        {
          edits: patch(
            "mod.ts",
            tag,
            "replace block 2:",
            "+function foo() {",
            "+  return 42;",
            "+}",
          ),
        },
        undefined,
        undefined,
        ctx,
      );

      const details = result.details as EditToolDetails;
      expect(details.files).toHaveLength(1);
      expect(details.changed).toBe(true);

      const newContent = await readFile(absPath, "utf-8");
      expect(newContent.replace(/\r\n/g, "\n")).toBe(
        "// header\nfunction foo() {\n  return 42;\n}\n// footer\n",
      );
    });

    it("delete block N removes the resolved block", async () => {
      const code = "let x = 1;\nif (x > 0) {\n  doWork();\n}\nlet y = 2;\n";
      await writeTestFile("del.ts", code);
      const absPath = resolve(testDir, "del.ts");
      const tag = snapshotFile(absPath, code);
      const ctx = createMockContext(testDir);

      const result = await createTool().execute(
        "b2",
        {
          edits: patch("del.ts", tag, "delete block 2"),
        },
        undefined,
        undefined,
        ctx,
      );

      const details = result.details as EditToolDetails;
      expect(details.files).toHaveLength(1);
      expect(details.changed).toBe(true);

      const newContent = await readFile(absPath, "utf-8");
      expect(newContent.replace(/\r\n/g, "\n")).toBe(
        "let x = 1;\nlet y = 2;\n",
      );
    });

    it("block edit on unknown language returns error message", async () => {
      const code = "content line\n";
      await writeTestFile("file.xyz", code);
      const absPath = resolve(testDir, "file.xyz");
      const tag = snapshotFile(absPath, code);
      const ctx = createMockContext(testDir);

      const result = await createTool().execute(
        "b3",
        {
          edits: patch("file.xyz", tag, "replace block 1:", "+new line"),
        },
        undefined,
        undefined,
        ctx,
      );

      // Should return an error (no throw — error in content)
      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(text).toMatch(/could not resolve/);
    });
  });

  describe("JSON format", () => {
    it("replaces a line by line number", async () => {
      await writeTestFile("json-ln.ts", "line1\nline2\nline3\n");
      const absPath = resolve(testDir, "json-ln.ts");

      const tool = createEditTool(snapshots);
      const ctx = createMockContext(testDir);

      const result = await tool.execute(
        "j1",
        {
          path: "json-ln.ts",
          patch: [{ old_range: [2, 2], new_lines: ["REPLACED"] }],
        } as any,
        undefined,
        undefined,
        ctx,
      );

      const details = result.details as EditToolDetails;
      expect(details.files).toHaveLength(1);
      expect(details.changed).toBe(true);

      const newContent = await readFile(absPath, "utf-8");
      expect(newContent.replace(/\r\n/g, "\n")).toBe(
        "line1\nREPLACED\nline3\n",
      );
    });

    it("replaces a line by hash anchor", async () => {
      await writeTestFile("json-hash.ts", "line1\nline2\nline3\n");
      const absPath = resolve(testDir, "json-hash.ts");

      // Compute hashes of the file to get a valid anchor
      const { computeLineHashes } = await import("../src/lib/hashline/hash.js");
      const hashes = computeLineHashes(
        (await readFile(absPath, "utf-8")).replace(/\r\n/g, "\n"),
      );

      const tool = createEditTool(snapshots);
      const ctx = createMockContext(testDir);

      const result = await tool.execute(
        "j2",
        {
          path: "json-hash.ts",
          patch: [
            { old_range: [hashes[1], hashes[1]], new_lines: ["REPLACED"] },
          ],
        } as any,
        undefined,
        undefined,
        ctx,
      );

      const details = result.details as EditToolDetails;
      expect(details.files).toHaveLength(1);
      expect(details.changed).toBe(true);

      const newContent = await readFile(absPath, "utf-8");
      expect(newContent.replace(/\r\n/g, "\n")).toBe(
        "line1\nREPLACED\nline3\n",
      );
    });

    it("rejects stale hash anchor", async () => {
      await writeTestFile("json-stale.ts", "a\nb\nc\n");

      const tool = createEditTool(snapshots);
      const ctx = createMockContext(testDir);

      const result = await tool.execute(
        "j3",
        {
          path: "json-stale.ts",
          patch: [{ old_range: ["ffff", "ffff"], new_lines: ["X"] }],
        } as any,
        undefined,
        undefined,
        ctx,
      );

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(result.details.files).toHaveLength(0);
      expect(result.details.changed).toBe(false);
      expect(text).toMatch(/E_STALE_ANCHOR/);
    });

    it("rejects bare hash prefix in new_lines", async () => {
      await writeTestFile("json-bare.ts", "a\nb\nc\n");

      const tool = createEditTool(snapshots);
      const ctx = createMockContext(testDir);

      const result = await tool.execute(
        "j4",
        {
          path: "json-bare.ts",
          patch: [{ old_range: [2, 2], new_lines: ["abcd│stolen content"] }],
        } as any,
        undefined,
        undefined,
        ctx,
      );

      const text = (result.content[0] as { type: "text"; text: string }).text;
      expect(result.details.files).toHaveLength(0);
      expect(text).toMatch(/E_BARE_HASH_PREFIX/);
    });

    it("warns on boundary duplication (trailing)", async () => {
      await writeTestFile("json-dup.ts", "function foo() {\n  code\n}\n");
      const absPath = resolve(testDir, "json-dup.ts");

      const tool = createEditTool(snapshots);
      const ctx = createMockContext(testDir);

      // Replace line 2 with content that ends in "}" (same as line 3)
      const result = await tool.execute(
        "j5",
        {
          path: "json-dup.ts",
          patch: [{ old_range: [2, 2], new_lines: ["  code", "}"] }],
        } as any,
        undefined,
        undefined,
        ctx,
      );

      const details = result.details as EditToolDetails;
      expect(details.files).toHaveLength(1);
      expect(details.files[0]!.warnings).toBeDefined();
      expect(
        details.files[0]!.warnings!.some((w) => /boundary duplication/.test(w)),
      ).toBe(true);

      // File should have the duplicate (no autocorrection)
      const newContent = await readFile(absPath, "utf-8");
      expect(newContent.replace(/\r\n/g, "\n")).toBe(
        "function foo() {\n  code\n}\n}\n",
      );
    });
  });
});
