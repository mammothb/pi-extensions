import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadGlobalMemory,
  loadMemory,
  loadMemoryMeta,
} from "../src/lib/store.js";
import { createRetainTool } from "../src/retain.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-retain-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

describe("retain tool", () => {
  it("registers with the expected name", () => {
    const tool = createRetainTool(baseDir);
    expect(tool.name).toBe("retain");
  });

  it("stores a key-value pair", async () => {
    const tool = createRetainTool(baseDir);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { key: "build", value: "pnpm build" },
      undefined,
      undefined,
      ctx,
    );

    const memory = loadMemory("/test/project", baseDir);
    expect(memory).toEqual({ build: "pnpm build" });
  });

  it("overwrites an existing key", async () => {
    const tool = createRetainTool(baseDir);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { key: "build", value: "make" },
      undefined,
      undefined,
      ctx,
    );
    await tool.execute(
      "call-2",
      { key: "build", value: "pnpm build" },
      undefined,
      undefined,
      ctx,
    );

    const memory = loadMemory("/test/project", baseDir);
    expect(memory).toEqual({ build: "pnpm build" });
  });

  it("returns confirmation with key name", async () => {
    const tool = createRetainTool(baseDir);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { key: "my-key", value: "value" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content).toEqual([
      { type: "text", text: 'Retained "my-key"' },
    ]);
  });

  it("rejects empty key", async () => {
    const tool = createRetainTool(baseDir);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { key: "   ", value: "v" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content).toEqual([
      { type: "text", text: "Error: key must not be empty" },
    ]);
  });

  it("handles keys with special characters", async () => {
    const tool = createRetainTool(baseDir);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { key: "reflection-2026-06-07T14:30:00.000Z", value: "some learning" },
      undefined,
      undefined,
      ctx,
    );

    const memory = loadMemory("/test/project", baseDir);
    expect(memory["reflection-2026-06-07T14:30:00.000Z"]).toBe("some learning");
  });

  it("handles empty value", async () => {
    const tool = createRetainTool(baseDir);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { key: "empty-value", value: "" },
      undefined,
      undefined,
      ctx,
    );

    const memory = loadMemory("/test/project", baseDir);
    expect(memory).toEqual({ "empty-value": "" });
  });

  describe("global scope", () => {
    it("writes to global.json when scope is global", async () => {
      const tool = createRetainTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "g1",
        { key: "user:editor", value: "vscode", scope: "global" },
        undefined,
        undefined,
        ctx,
      );

      const globalMem = loadGlobalMemory(baseDir);
      expect(globalMem).toEqual({ "user:editor": "vscode" });
      // Project memory should be unaffected
      const projectMem = loadMemory("/test/project", baseDir);
      expect(projectMem).toEqual({});
    });

    it("returns confirmation with (global) label", async () => {
      const tool = createRetainTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "g2",
        { key: "user:editor", value: "vscode", scope: "global" },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        { type: "text", text: 'Retained "user:editor" (global)' },
      ]);
    });

    it("defaults to project scope when scope is omitted", async () => {
      const tool = createRetainTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "g3",
        { key: "build", value: "pnpm build" },
        undefined,
        undefined,
        ctx,
      );

      const projectMem = loadMemory("/test/project", baseDir);
      expect(projectMem).toEqual({ build: "pnpm build" });
      const globalMem = loadGlobalMemory(baseDir);
      expect(globalMem).toEqual({});
    });
  });

  describe("TTL", () => {
    it("stores TTL metadata alongside the memory entry", async () => {
      const tool = createRetainTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "t1",
        { key: "temp-key", value: "temp-value", ttlSeconds: 3600 },
        undefined,
        undefined,
        ctx,
      );

      const memory = loadMemory("/test/project", baseDir);
      expect(memory).toEqual({ "temp-key": "temp-value" });

      const meta = loadMemoryMeta("/test/project", baseDir);
      expect(meta["temp-key"]).toBeDefined();
      expect(new Date(meta["temp-key"]!.expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it("entry with ttlSeconds: 0 expires immediately", async () => {
      const tool = createRetainTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "t2",
        { key: "instant-expire", value: "gone", ttlSeconds: 0.01 },
        undefined,
        undefined,
        ctx,
      );

      // Wait for expiry
      await new Promise((r) => setTimeout(r, 20));

      // loadMemory filters expired
      const memory = loadMemory("/test/project", baseDir);
      expect(memory).toEqual({});
    });

    it("overwriting with TTL clears previous meta and sets new meta", async () => {
      const tool = createRetainTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      // First write with TTL
      await tool.execute(
        "t3",
        { key: "key", value: "v1", ttlSeconds: 3600 },
        undefined,
        undefined,
        ctx,
      );
      let meta = loadMemoryMeta("/test/project", baseDir);
      expect(meta.key).toBeDefined();

      // Overwrite without TTL
      await tool.execute(
        "t4",
        { key: "key", value: "v2" },
        undefined,
        undefined,
        ctx,
      );
      meta = loadMemoryMeta("/test/project", baseDir);
      expect(meta.key).toBeUndefined();

      const memory = loadMemory("/test/project", baseDir);
      expect(memory).toEqual({ key: "v2" });
    });

    it("retain with ttlSeconds shows expiry in confirmation", async () => {
      const tool = createRetainTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "t5",
        { key: "tempo", value: "val", ttlSeconds: 60 },
        undefined,
        undefined,
        ctx,
      );

      expect((result.content[0] as any).text).toContain("expires in 60s");
    });
  });
});
