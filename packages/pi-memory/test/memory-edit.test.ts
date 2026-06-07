import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMemory, loadMemoryMeta } from "../src/lib/store.js";
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

describe("memory_edit tool", () => {
  it("registers with the expected name", () => {
    const tool = createMemoryEditTool(baseDir);
    expect(tool.name).toBe("memory_edit");
  });

  describe("delete", () => {
    it("deletes an existing key", async () => {
      const retain = createRetainTool(baseDir);
      const edit = createMemoryEditTool(baseDir);
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
      const memory = loadMemory("/test/project", baseDir);
      expect(memory).toEqual({});
    });

    it("reports when key is not found", async () => {
      const edit = createMemoryEditTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      const result = await edit.execute(
        "e2",
        { action: "delete", key: "nonexistent" },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        {
          type: "text",
          text: 'Key "nonexistent" not found — nothing deleted.',
        },
      ]);
    });

    it("does not affect other keys when deleting", async () => {
      const retain = createRetainTool(baseDir);
      const edit = createMemoryEditTool(baseDir);
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

      const memory = loadMemory("/test/project", baseDir);
      expect(memory).toEqual({ keep: "kept" });
    });
  });

  describe("rename", () => {
    it("renames an existing key", async () => {
      const retain = createRetainTool(baseDir);
      const edit = createMemoryEditTool(baseDir);
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

      const memory = loadMemory("/test/project", baseDir);
      expect(memory).toEqual({ "new-name": "the value" });
    });

    it("overwrites newKey if it already exists", async () => {
      const retain = createRetainTool(baseDir);
      const edit = createMemoryEditTool(baseDir);
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

      const memory = loadMemory("/test/project", baseDir);
      expect(memory).toEqual({ "new-name": "old value" });
    });

    it("reports error when newKey is missing", async () => {
      const edit = createMemoryEditTool(baseDir);
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
      const edit = createMemoryEditTool(baseDir);
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

    it("reports when source key is not found", async () => {
      const edit = createMemoryEditTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      const result = await edit.execute(
        "e8",
        { action: "rename", key: "nonexistent", newKey: "dest" },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        {
          type: "text",
          text: 'Key "nonexistent" not found — nothing renamed.',
        },
      ]);
    });
  });

  describe("TTL cleanup", () => {
    it("delete removes TTL metadata alongside the key", async () => {
      const retain = createRetainTool(baseDir);
      const edit = createMemoryEditTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      await retain.execute(
        "t1",
        { key: "temp", value: "val", ttlSeconds: 3600 },
        undefined,
        undefined,
        ctx,
      );

      let meta = loadMemoryMeta("/test/project", baseDir);
      expect(meta.temp).toBeDefined();

      await edit.execute(
        "t2",
        { action: "delete", key: "temp" },
        undefined,
        undefined,
        ctx,
      );

      meta = loadMemoryMeta("/test/project", baseDir);
      expect(meta.temp).toBeUndefined();
      const memory = loadMemory("/test/project", baseDir);
      expect(memory.temp).toBeUndefined();
    });

    it("rename moves TTL metadata to the new key", async () => {
      const retain = createRetainTool(baseDir);
      const edit = createMemoryEditTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      await retain.execute(
        "t3",
        { key: "old", value: "val", ttlSeconds: 3600 },
        undefined,
        undefined,
        ctx,
      );

      await edit.execute(
        "t4",
        { action: "rename", key: "old", newKey: "new" },
        undefined,
        undefined,
        ctx,
      );

      const meta = loadMemoryMeta("/test/project", baseDir);
      expect(meta.old).toBeUndefined();
      expect(meta.new).toBeDefined();
    });
  });
});
