import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemBackend } from "../src/lib/backends/filesystem.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-store-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

function makeBackend() {
  return new FileSystemBackend({ baseDir });
}

/** Replicate the hash logic so we can construct file paths for robustness tests. */
function hashCwd(cwd: string): string {
  return crypto.createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

function resolveMemoryPath(cwd: string): string {
  return path.join(baseDir, "pi-memory", hashCwd(cwd), "memory.json");
}

function resolveGlobalPath(): string {
  return path.join(baseDir, "pi-memory", "global.json");
}

function resolveIndexPath(): string {
  return path.join(baseDir, "pi-memory", "index.json");
}

describe("FileSystemBackend", () => {
  describe("remember / recall (project scope)", () => {
    it("stores and recalls a single entry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "build-command",
        value: "pnpm run build",
      });

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        {
          key: "build-command",
          value: "pnpm run build",
          scope: "project",
        },
      ]);
    });

    it("returns {} when no memory exists for a cwd", async () => {
      const backend = makeBackend();
      const entries = await backend.recall({
        cwd: "/nonexistent/cwd",
        options: { list: true },
      });
      expect(entries).toEqual([]);
    });

    it("returns {} when memory file is invalid JSON", async () => {
      const filePath = resolveMemoryPath("/test/cwd");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "not json", "utf-8");

      const backend = makeBackend();
      const entries = await backend.recall({
        cwd: "/test/cwd",
        options: { list: true },
      });
      expect(entries).toEqual([]);
    });

    it("returns {} when memory file is a JSON array", async () => {
      const filePath = resolveMemoryPath("/test/cwd");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '["a", "b"]', "utf-8");

      const backend = makeBackend();
      const entries = await backend.recall({
        cwd: "/test/cwd",
        options: { list: true },
      });
      expect(entries).toEqual([]);
    });

    it("filters out non-string values on load", async () => {
      const filePath = resolveMemoryPath("/test/cwd");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({ valid: "string", invalid: 42, alsoInvalid: true }),
        "utf-8",
      );

      const backend = makeBackend();
      const entries = await backend.recall({
        cwd: "/test/cwd",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe("valid");
    });

    it("overwrites existing entry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/cwd",
        key: "old",
        value: "data",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/cwd",
        key: "old",
        value: "new",
      });

      const entries = await backend.recall({
        cwd: "/test/cwd",
        options: { list: true },
      });
      expect(entries).toMatchObject([{ key: "old", value: "new" }]);
    });

    it("project entries are isolated by cwd", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/project-a",
        key: "build",
        value: "make",
      });
      await backend.retain({
        scope: "project",
        cwd: "/project-b",
        key: "build",
        value: "cargo build",
      });

      const entriesA = await backend.recall({
        cwd: "/project-a",
        options: { list: true },
      });
      expect(entriesA).toMatchObject([{ key: "build", value: "make" }]);

      const entriesB = await backend.recall({
        cwd: "/project-b",
        options: { list: true },
      });
      expect(entriesB).toMatchObject([{ key: "build", value: "cargo build" }]);
    });
  });

  describe("remember / recall (global scope)", () => {
    it("stores and recalls a global entry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "user:editor",
        value: "vscode",
      });

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        { key: "user:editor", value: "vscode", scope: "global" },
      ]);
    });

    it("returns {} when global.json does not exist", async () => {
      const backend = makeBackend();
      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toEqual([]);
    });

    it("global entries are visible from any project cwd", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "user:theme",
        value: "dark",
      });

      const entries = await backend.recall({
        cwd: "/completely/different/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        { key: "user:theme", value: "dark", scope: "global" },
      ]);
    });

    it("returns {} when global.json is invalid JSON", async () => {
      const filePath = resolveGlobalPath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "not json", "utf-8");

      const backend = makeBackend();
      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toEqual([]);
    });
  });

  describe("merge: project overrides global", () => {
    it("project entry with same key overrides global", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "theme",
        value: "global-dark",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "theme",
        value: "project-light",
      });

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        key: "theme",
        value: "project-light",
        scope: "project",
      });
    });
  });

  describe("forget", () => {
    it("deletes an existing project entry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "delete-me",
        value: "gone",
      });

      await backend.forget({
        scope: "project",
        cwd: "/test/project",
        key: "delete-me",
      });

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(0);
    });

    it("is a no-op when key does not exist", async () => {
      const backend = makeBackend();
      // Should not throw
      await backend.forget({
        scope: "project",
        cwd: "/test/project",
        key: "nonexistent",
      });
    });

    it("deletes an existing global entry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "gone-global",
        value: "bye",
      });

      await backend.forget({
        scope: "global",
        cwd: "/test/project",
        key: "gone-global",
      });

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(0);
    });
  });

  describe("rename", () => {
    it("renames an existing project entry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "old-name",
        value: "the value",
      });

      await backend.rename({
        scope: "project",
        cwd: "/test/project",
        oldKey: "old-name",
        newKey: "new-name",
      });

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        { key: "new-name", value: "the value", scope: "project" },
      ]);
    });

    it("is a no-op when oldKey does not exist", async () => {
      const backend = makeBackend();
      // Should not throw
      await backend.rename({
        scope: "project",
        cwd: "/test/project",
        oldKey: "nonexistent",
        newKey: "dest",
      });
    });

    it("renames an existing global entry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "old-global",
        value: "global val",
      });

      await backend.rename({
        scope: "global",
        cwd: "/test/project",
        oldKey: "old-global",
        newKey: "new-global",
      });

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        { key: "new-global", value: "global val", scope: "global" },
      ]);
    });
  });

  describe("getIndex / upsertIndex", () => {
    it("returns {} when index.json does not exist", async () => {
      const backend = makeBackend();
      const index = await backend.getIndex();
      expect(index).toEqual({});
    });

    it("saves and loads index entries", async () => {
      const backend = makeBackend();
      await backend.upsertIndex("/home/user/app", {
        path: "/home/user/app",
        lastAccess: "2026-01-01T00:00:00.000Z",
      });

      const index = await backend.getIndex();
      const hash = hashCwd("/home/user/app");
      expect(index[hash]).toEqual({
        path: "/home/user/app",
        lastAccess: "2026-01-01T00:00:00.000Z",
      });
    });

    it("filters out invalid index entries on load", async () => {
      const filePath = resolveIndexPath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          valid: { path: "/ok", lastAccess: "2026-01-01T00:00:00.000Z" },
          invalid: "not an object",
          noPath: { lastAccess: "2026-01-01T00:00:00.000Z" },
        }),
        "utf-8",
      );

      const backend = makeBackend();
      const index = await backend.getIndex();
      expect(Object.keys(index)).toEqual(["valid"]);
    });

    it("upsertIndex updates existing entry", async () => {
      const backend = makeBackend();
      await backend.upsertIndex("/my/project", {
        path: "/my/project",
        lastAccess: "2026-01-01T00:00:00.000Z",
      });
      await backend.upsertIndex("/my/project", {
        path: "/my/project",
        lastAccess: "2026-06-01T00:00:00.000Z",
      });

      const index = await backend.getIndex();
      const hash = hashCwd("/my/project");
      expect(index[hash]!.lastAccess).toBe("2026-06-01T00:00:00.000Z");
    });
  });

  describe("TTL", () => {
    it("recall filters out expired entries", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/ttl",
        key: "permanent",
        value: "keep",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/ttl",
        key: "ephemeral",
        value: "discard",
        ttlSeconds: 0.01,
      });

      // Wait for ephemeral to expire
      await new Promise((r) => setTimeout(r, 20));

      const entries = await backend.recall({
        cwd: "/test/ttl",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe("permanent");
    });

    it("recall keeps entries with future expiry", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/ttl",
        key: "temp",
        value: "keep",
        ttlSeconds: 3600,
      });

      const entries = await backend.recall({
        cwd: "/test/ttl",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe("temp");
    });

    it("recall handles entries without meta (no expiry)", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/ttl",
        key: "plain",
        value: "no meta",
      });

      const entries = await backend.recall({
        cwd: "/test/ttl",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
    });

    it("global memory also supports TTL filtering", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/ttl",
        key: "perm",
        value: "keep",
      });
      await backend.retain({
        scope: "global",
        cwd: "/test/ttl",
        key: "temp",
        value: "gone",
        ttlSeconds: 0.01,
      });

      await new Promise((r) => setTimeout(r, 20));

      const entries = await backend.recall({
        cwd: "/test/ttl",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe("perm");
      expect(entries[0]!.scope).toBe("global");
    });
  });

  describe("search", () => {
    it("returns scored results for keyword query", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/search",
        key: "build-command",
        value: "pnpm run build",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/search",
        key: "test-command",
        value: "pnpm test",
      });

      const entries = await backend.recall({
        cwd: "/test/search",
        options: { query: "build" },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe("build-command");
      expect(entries[0]!.score).toBeGreaterThan(0);
    });

    it("key matches score higher than value matches", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/search",
        key: "format",
        value: "biome",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/search",
        key: "tool-pref",
        value: "use format for code",
      });

      const entries = await backend.recall({
        cwd: "/test/search",
        options: { query: "format" },
      });
      expect(entries.length).toBeGreaterThanOrEqual(2);
      // "format" key should score higher and come first
      expect(entries[0]!.key).toBe("format");
    });

    it("returns empty array for no-match query", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/search",
        key: "foo",
        value: "bar",
      });

      const entries = await backend.recall({
        cwd: "/test/search",
        options: { query: "xyzzy" },
      });
      expect(entries).toEqual([]);
    });

    it("respects limit option", async () => {
      const backend = makeBackend();
      for (let i = 0; i < 10; i++) {
        await backend.retain({
          scope: "project",
          cwd: "/test/search",
          key: `test-${i}`,
          value: `test value ${i}`,
        });
      }

      const entries = await backend.recall({
        cwd: "/test/search",
        options: { query: "test", limit: 3 },
      });
      expect(entries).toHaveLength(3);
    });
  });

  describe("namespace filtering", () => {
    it("filters entries by namespace prefix", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/ns",
        key: "project:build",
        value: "pnpm build",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/ns",
        key: "project:test",
        value: "vitest",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/ns",
        key: "user:editor",
        value: "vscode",
      });

      const entries = await backend.recall({
        cwd: "/test/ns",
        options: { list: true, namespace: "project:" },
      });
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.key).sort()).toEqual([
        "project:build",
        "project:test",
      ]);
    });
  });
});
