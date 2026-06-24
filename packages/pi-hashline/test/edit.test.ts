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

/**
 * Build a hashline patch string for a single file.
 */

describe("edit tool (hashline)", () => {
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

    it("replaces a block by line number in JSON format", async () => {
      const code = "// header\nfunction foo() {\n  return 1;\n}\n// footer\n";
      await writeTestFile("json-block.ts", code);
      const absPath = resolve(testDir, "json-block.ts");
      const blockResolver = createTreeSitterBlockResolver();
      const tool = createEditTool(snapshots, blockResolver);
      const ctx = createMockContext(testDir);

      const result = await tool.execute(
        "jb1",
        {
          path: "json-block.ts",
          patch: [
            { block: 2, new_lines: ["function foo() {", "  return 42;", "}"] },
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
        "// header\nfunction foo() {\n  return 42;\n}\n// footer\n",
      );
    });

    it("deletes a block in JSON format", async () => {
      const code = "let x = 1;\nif (x > 0) {\n  doWork();\n}\nlet y = 2;\n";
      await writeTestFile("json-del-block.ts", code);
      const absPath = resolve(testDir, "json-del-block.ts");
      const blockResolver = createTreeSitterBlockResolver();
      const tool = createEditTool(snapshots, blockResolver);
      const ctx = createMockContext(testDir);

      const result = await tool.execute(
        "jb2",
        {
          path: "json-del-block.ts",
          patch: [{ block: 2, new_lines: [] }],
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
        "let x = 1;\nlet y = 2;\n",
      );
    });
  });
});
