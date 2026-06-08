import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemBackend } from "../src/lib/backends/filesystem.js";
import { createMemoryEditTool } from "../src/memory-edit.js";
import { createRetainTool } from "../src/retain.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-edit-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

function makeBackend() {
  return new FileSystemBackend({ baseDir });
}

describe("memory_edit tool", () => {
  it("registers with the expected name", () => {
    const tool = createMemoryEditTool(makeBackend());
    expect(tool.name).toBe("memory_edit");
  });

  describe("delete", () => {
    it("deletes an existing key", async () => {
      const backend = makeBackend();
      const retain = createRetainTool(backend);
      const edit = createMemoryEditTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await retain.execute(
        "r1",
        { key: "temp-key", value: "some value" },
        undefined,
        undefined,
        ctx,
      );

      const result = await edit.execute(
        "e1",
        { action: "delete", key: "temp-key" },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        { type: "text", text: 'Deleted "temp-key"' },
      ]);

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(0);
    });

    it("does not affect other keys when deleting", async () => {
      const backend = makeBackend();
      const retain = createRetainTool(backend);
      const edit = createMemoryEditTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await retain.execute(
        "r2",
        { key: "keep", value: "kept" },
        undefined,
        undefined,
        ctx,
      );
      await retain.execute(
        "r3",
        { key: "remove", value: "gone" },
        undefined,
        undefined,
        ctx,
      );

      await edit.execute(
        "e3",
        { action: "delete", key: "remove" },
        undefined,
        undefined,
        ctx,
      );

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        { key: "keep", value: "kept", scope: "project" },
      ]);
    });
  });

  describe("rename", () => {
    it("renames an existing key", async () => {
      const backend = makeBackend();
      const retain = createRetainTool(backend);
      const edit = createMemoryEditTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await retain.execute(
        "r4",
        { key: "old-name", value: "the value" },
        undefined,
        undefined,
        ctx,
      );

      const result = await edit.execute(
        "e4",
        { action: "rename", key: "old-name", newKey: "new-name" },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        { type: "text", text: 'Renamed "old-name" → "new-name"' },
      ]);

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        { key: "new-name", value: "the value", scope: "project" },
      ]);
    });

    it("overwrites newKey if it already exists", async () => {
      const backend = makeBackend();
      const retain = createRetainTool(backend);
      const edit = createMemoryEditTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await retain.execute(
        "r5",
        { key: "old-name", value: "old value" },
        undefined,
        undefined,
        ctx,
      );
      await retain.execute(
        "r6",
        { key: "new-name", value: "will be overwritten" },
        undefined,
        undefined,
        ctx,
      );

      await edit.execute(
        "e5",
        { action: "rename", key: "old-name", newKey: "new-name" },
        undefined,
        undefined,
        ctx,
      );

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        key: "new-name",
        value: "old value",
        scope: "project",
      });
    });

    it("reports error when newKey is missing", async () => {
      const edit = createMemoryEditTool(makeBackend());
      const ctx = { cwd: "/test/project" } as any;

      const result = await edit.execute(
        "e6",
        { action: "rename", key: "a" },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        {
          type: "text",
          text: 'Error: "newKey" is required for rename action.',
        },
      ]);
    });

    it("reports error when newKey is same as key", async () => {
      const edit = createMemoryEditTool(makeBackend());
      const ctx = { cwd: "/test/project" } as any;

      const result = await edit.execute(
        "e7",
        { action: "rename", key: "same", newKey: "same" },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        {
          type: "text",
          text: 'Error: newKey is the same as key ("same") — nothing renamed.',
        },
      ]);
    });
  });

  describe("TTL cleanup", () => {
    it("delete removes the entry (TTL is cleaned up internally)", async () => {
      const backend = makeBackend();
      const retain = createRetainTool(backend);
      const edit = createMemoryEditTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      // Store with TTL
      await retain.execute(
        "t1",
        { key: "temp", value: "val", ttlSeconds: 3600 },
        undefined,
        undefined,
        ctx,
      );

      // Verify it exists
      let entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);

      // Delete
      await edit.execute(
        "t2",
        { action: "delete", key: "temp" },
        undefined,
        undefined,
        ctx,
      );

      // Verify it's gone
      entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(0);
    });

    it("rename preserves value (TTL is moved internally)", async () => {
      const backend = makeBackend();
      const retain = createRetainTool(backend);
      const edit = createMemoryEditTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      // Store with TTL
      await retain.execute(
        "t3",
        { key: "old", value: "val", ttlSeconds: 3600 },
        undefined,
        undefined,
        ctx,
      );

      // Rename
      await edit.execute(
        "t4",
        { action: "rename", key: "old", newKey: "new" },
        undefined,
        undefined,
        ctx,
      );

      // Verify new key exists with the value
      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        key: "new",
        value: "val",
        scope: "project",
      });
    });
  });
});
