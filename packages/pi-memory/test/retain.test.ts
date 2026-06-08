import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemBackend } from "../src/lib/backends/filesystem.js";
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

function makeBackend() {
  return new FileSystemBackend({ baseDir });
}

describe("retain tool", () => {
  it("registers with the expected name", () => {
    const tool = createRetainTool(makeBackend());
    expect(tool.name).toBe("retain");
  });

  it("stores a key-value pair", async () => {
    const backend = makeBackend();
    const tool = createRetainTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { key: "build", value: "pnpm build" },
      undefined,
      undefined,
      ctx,
    );

    const entries = await backend.recall({
      cwd: "/test/project",
      options: { list: true },
    });
    expect(entries).toMatchObject([
      { key: "build", value: "pnpm build", scope: "project" },
    ]);
  });

  it("overwrites an existing key", async () => {
    const backend = makeBackend();
    const tool = createRetainTool(backend);
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

    const entries = await backend.recall({
      cwd: "/test/project",
      options: { list: true },
    });
    expect(entries).toMatchObject([
      { key: "build", value: "pnpm build", scope: "project" },
    ]);
  });

  it("returns confirmation with key name", async () => {
    const tool = createRetainTool(makeBackend());
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
    const tool = createRetainTool(makeBackend());
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
    const backend = makeBackend();
    const tool = createRetainTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { key: "reflection-2026-06-07T14:30:00.000Z", value: "some learning" },
      undefined,
      undefined,
      ctx,
    );

    const entries = await backend.recall({
      cwd: "/test/project",
      options: { query: "learning" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toBe("reflection-2026-06-07T14:30:00.000Z");
    expect(entries[0]!.value).toBe("some learning");
  });

  it("handles empty value", async () => {
    const backend = makeBackend();
    const tool = createRetainTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { key: "empty-value", value: "" },
      undefined,
      undefined,
      ctx,
    );

    const entries = await backend.recall({
      cwd: "/test/project",
      options: { list: true },
    });
    expect(entries).toMatchObject([
      { key: "empty-value", value: "", scope: "project" },
    ]);
  });

  describe("global scope", () => {
    it("writes to global scope when scope is global", async () => {
      const backend = makeBackend();
      const tool = createRetainTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "g1",
        { key: "user:editor", value: "vscode", scope: "global" },
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
        key: "user:editor",
        value: "vscode",
        scope: "global",
      });

      // Verify it's visible from a different project cwd
      const otherEntries = await backend.recall({
        cwd: "/other/project",
        options: { list: true },
      });
      expect(otherEntries).toHaveLength(1);
      expect(otherEntries[0]).toMatchObject({
        key: "user:editor",
        value: "vscode",
        scope: "global",
      });
    });

    it("returns confirmation with (global) label", async () => {
      const tool = createRetainTool(makeBackend());
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
      const backend = makeBackend();
      const tool = createRetainTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "g3",
        { key: "build", value: "pnpm build" },
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
        key: "build",
        value: "pnpm build",
        scope: "project",
      });

      // Should not be visible from a different project
      const otherEntries = await backend.recall({
        cwd: "/other/project",
        options: { list: true },
      });
      const projectKeys = otherEntries
        .filter((e) => e.scope === "project")
        .map((e) => e.key);
      expect(projectKeys).not.toContain("build");
    });
  });

  describe("TTL", () => {
    it("stores entry with TTL (visible before expiry)", async () => {
      const backend = makeBackend();
      const tool = createRetainTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "t1",
        { key: "temp-key", value: "temp-value", ttlSeconds: 3600 },
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
        key: "temp-key",
        value: "temp-value",
        scope: "project",
      });
    });

    it("entry with ttlSeconds: 0 expires immediately", async () => {
      const backend = makeBackend();
      const tool = createRetainTool(backend);
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

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(0);
    });

    it("overwriting with TTL then without TTL clears expiry", async () => {
      const backend = makeBackend();
      const tool = createRetainTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      // First write with TTL
      await tool.execute(
        "t3",
        { key: "key", value: "v1", ttlSeconds: 3600 },
        undefined,
        undefined,
        ctx,
      );

      // Overwrite without TTL
      await tool.execute(
        "t4",
        { key: "key", value: "v2" },
        undefined,
        undefined,
        ctx,
      );

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toMatchObject([
        { key: "key", value: "v2", scope: "project" },
      ]);
    });

    it("retain with ttlSeconds shows expiry in confirmation", async () => {
      const tool = createRetainTool(makeBackend());
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
