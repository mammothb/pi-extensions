import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashCwd,
  loadGlobalMemory,
  loadIndex,
  loadMemory,
  loadMemoryMeta,
  resolveGlobalPath,
  resolveIndexPath,
  resolveMemoryPath,
  saveGlobalMemory,
  saveGlobalMemoryMeta,
  saveIndex,
  saveMemory,
  saveMemoryMeta,
} from "../src/lib/store.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-store-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

describe("hashCwd", () => {
  it("returns a 16-character hex string", () => {
    const hash = hashCwd("/home/user/my-project");
    expect(hash).toHaveLength(16);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });

  it("produces different hashes for different cwds", () => {
    const a = hashCwd("/home/user/project-a");
    const b = hashCwd("/home/user/project-b");
    expect(a).not.toBe(b);
  });

  it("produces the same hash for the same cwd", () => {
    const a = hashCwd("/home/user/my-project");
    const b = hashCwd("/home/user/my-project");
    expect(a).toBe(b);
  });
});

describe("resolveMemoryPath", () => {
  it("returns path under baseDir/pi-memory/<hash>/memory.json", () => {
    const cwd = "/home/user/test-project";
    const result = resolveMemoryPath(cwd, baseDir);
    const expectedDir = path.join(baseDir, "pi-memory", hashCwd(cwd));
    expect(result).toBe(path.join(expectedDir, "memory.json"));
  });
});

describe("loadMemory", () => {
  it("returns {} when memory file does not exist", () => {
    const result = loadMemory("/nonexistent/cwd", baseDir);
    expect(result).toEqual({});
  });

  it("returns {} when memory file is invalid JSON", () => {
    const filePath = resolveMemoryPath("/test/cwd", baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "not json", "utf-8");
    const result = loadMemory("/test/cwd", baseDir);
    expect(result).toEqual({});
  });

  it("returns {} when memory file is a JSON array", () => {
    const filePath = resolveMemoryPath("/test/cwd", baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '["a", "b"]', "utf-8");
    const result = loadMemory("/test/cwd", baseDir);
    expect(result).toEqual({});
  });

  it("returns {} when memory file has non-object JSON", () => {
    const filePath = resolveMemoryPath("/test/cwd", baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '"just a string"', "utf-8");
    const result = loadMemory("/test/cwd", baseDir);
    expect(result).toEqual({});
  });

  it("loads existing entries", () => {
    const filePath = resolveMemoryPath("/test/cwd", baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ "build-command": "pnpm run build" }),
      "utf-8",
    );
    const result = loadMemory("/test/cwd", baseDir);
    expect(result).toEqual({ "build-command": "pnpm run build" });
  });

  it("filters out non-string values", () => {
    const filePath = resolveMemoryPath("/test/cwd", baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ valid: "string", invalid: 42, alsoInvalid: true }),
      "utf-8",
    );
    const result = loadMemory("/test/cwd", baseDir);
    expect(result).toEqual({ valid: "string" });
  });
});

describe("saveMemory", () => {
  it("creates parent directories if needed", () => {
    const cwd = "/test/new-project";
    saveMemory(cwd, { test: "value" }, baseDir);
    const filePath = resolveMemoryPath(cwd, baseDir);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("writes pretty-printed JSON", () => {
    const cwd = "/test/cwd";
    saveMemory(cwd, { a: "1", b: "2" }, baseDir);
    const filePath = resolveMemoryPath(cwd, baseDir);
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw).toBe('{\n  "a": "1",\n  "b": "2"\n}');
  });

  it("overwrites existing file", () => {
    const cwd = "/test/cwd";
    saveMemory(cwd, { old: "data" }, baseDir);
    saveMemory(cwd, { new: "data" }, baseDir);
    const loaded = loadMemory(cwd, baseDir);
    expect(loaded).toEqual({ new: "data" });
  });

  it("cleans up .tmp file after atomic write", () => {
    const cwd = "/test/cwd";
    saveMemory(cwd, { test: "value" }, baseDir);
    const filePath = resolveMemoryPath(cwd, baseDir);
    const tmpPath = `${filePath}.tmp`;
    // .tmp should be gone after successful rename
    expect(fs.existsSync(tmpPath)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("saves empty object", () => {
    const cwd = "/test/cwd";
    saveMemory(cwd, {}, baseDir);
    const loaded = loadMemory(cwd, baseDir);
    expect(loaded).toEqual({});
  });
});

describe("loadGlobalMemory", () => {
  it("returns {} when global.json does not exist", () => {
    const result = loadGlobalMemory(baseDir);
    expect(result).toEqual({});
  });

  it("loads existing global entries", () => {
    saveGlobalMemory({ "user:editor": "vscode" }, baseDir);
    const result = loadGlobalMemory(baseDir);
    expect(result).toEqual({ "user:editor": "vscode" });
  });

  it("returns {} when global.json is invalid JSON", () => {
    const filePath = resolveGlobalPath(baseDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "not json", "utf-8");
    const result = loadGlobalMemory(baseDir);
    expect(result).toEqual({});
  });
});

describe("saveGlobalMemory", () => {
  it("writes to global.json atomically", () => {
    saveGlobalMemory({ key: "value" }, baseDir);
    const filePath = resolveGlobalPath(baseDir);
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = fs.readFileSync(filePath, "utf-8");
    expect(raw).toBe('{\n  "key": "value"\n}');
  });

  it("overwrites existing global.json", () => {
    saveGlobalMemory({ old: "data" }, baseDir);
    saveGlobalMemory({ new: "data" }, baseDir);
    const loaded = loadGlobalMemory(baseDir);
    expect(loaded).toEqual({ new: "data" });
  });

  it("cleans up .tmp file after atomic write", () => {
    saveGlobalMemory({ test: "value" }, baseDir);
    const filePath = resolveGlobalPath(baseDir);
    const tmpPath = `${filePath}.tmp`;
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});

describe("loadIndex / saveIndex", () => {
  it("returns {} when index.json does not exist", () => {
    const result = loadIndex(baseDir);
    expect(result).toEqual({});
  });

  it("saves and loads index entries", () => {
    saveIndex(
      {
        a1b2c3: {
          path: "/home/user/app",
          lastAccess: "2026-01-01T00:00:00.000Z",
        },
      },
      baseDir,
    );
    const result = loadIndex(baseDir);
    expect(result).toEqual({
      a1b2c3: {
        path: "/home/user/app",
        lastAccess: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("writes to index.json atomically", () => {
    saveIndex(
      { abc: { path: "/tmp", lastAccess: "2026-01-01T00:00:00.000Z" } },
      baseDir,
    );
    const filePath = resolveIndexPath(baseDir);
    expect(fs.existsSync(filePath)).toBe(true);
    const tmpPath = `${filePath}.tmp`;
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it("filters out invalid index entries on load", () => {
    const filePath = resolveIndexPath(baseDir);
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
    const result = loadIndex(baseDir);
    expect(Object.keys(result)).toEqual(["valid"]);
  });
});

describe("TTL metadata", () => {
  const cwd = "/test/ttl-project";

  it("loadMemoryMeta returns {} when meta file does not exist", () => {
    const result = loadMemoryMeta(cwd, baseDir);
    expect(result).toEqual({});
  });

  it("saves and loads TTL metadata", () => {
    saveMemoryMeta(
      cwd,
      { key1: { expiresAt: "2026-07-01T00:00:00.000Z" } },
      baseDir,
    );
    const result = loadMemoryMeta(cwd, baseDir);
    expect(result).toEqual({
      key1: { expiresAt: "2026-07-01T00:00:00.000Z" },
    });
  });

  it("loadMemory filters out expired entries", () => {
    // Save two keys, one with expired TTL
    saveMemory(cwd, { permanent: "keep", ephemeral: "discard" }, baseDir);
    saveMemoryMeta(
      cwd,
      { ephemeral: { expiresAt: "2000-01-01T00:00:00.000Z" } },
      baseDir,
    );

    const result = loadMemory(cwd, baseDir);
    expect(result).toEqual({ permanent: "keep" });
  });

  it("loadMemory keeps entries with future expiry", () => {
    saveMemory(cwd, { temp: "keep" }, baseDir);
    saveMemoryMeta(
      cwd,
      { temp: { expiresAt: "2099-01-01T00:00:00.000Z" } },
      baseDir,
    );

    const result = loadMemory(cwd, baseDir);
    expect(result).toEqual({ temp: "keep" });
  });

  it("loadMemory handles entries without meta (no expiry)", () => {
    saveMemory(cwd, { plain: "no meta" }, baseDir);
    // No meta file at all
    const result = loadMemory(cwd, baseDir);
    expect(result).toEqual({ plain: "no meta" });
  });

  it("loadMemory returns all entries when no meta file exists", () => {
    saveMemory(cwd, { a: "1", b: "2" }, baseDir);
    // No meta file
    const result = loadMemory(cwd, baseDir);
    expect(result).toEqual({ a: "1", b: "2" });
  });

  it("global memory also supports TTL filtering", () => {
    saveGlobalMemory({ perm: "keep", temp: "gone" }, baseDir);
    saveGlobalMemoryMeta(
      { temp: { expiresAt: "2000-01-01T00:00:00.000Z" } },
      baseDir,
    );

    const result = loadGlobalMemory(baseDir);
    expect(result).toEqual({ perm: "keep" });
  });
});
