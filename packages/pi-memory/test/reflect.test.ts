import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemBackend } from "../src/lib/backends/filesystem.js";
import { createReflectTool } from "../src/reflect.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-reflect-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

function makeBackend() {
  return new FileSystemBackend({ baseDir });
}

describe("reflect tool", () => {
  it("registers with the expected name", () => {
    const tool = createReflectTool(makeBackend());
    expect(tool.name).toBe("reflect");
  });

  it("stores observation under auto-generated timestamp key", async () => {
    const backend = makeBackend();
    const tool = createReflectTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { observation: "This project uses TypeScript" },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain('Reflected as "reflection-');

    const entries = await backend.recall({
      cwd: "/test/project",
      options: { list: true },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toMatch(/^reflection-\d{4}-\d{2}-\d{2}T/);
    expect(entries[0]!.value).toBe("This project uses TypeScript");
    expect(entries[0]!.scope).toBe("project");
  });

  it("stores observation under explicit key when provided", async () => {
    const backend = makeBackend();
    const tool = createReflectTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { observation: "Uses pnpm workspaces", key: "project-structure" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content).toEqual([
      { type: "text", text: 'Reflected as "project-structure"' },
    ]);

    const entries = await backend.recall({
      cwd: "/test/project",
      options: { list: true },
    });
    expect(entries).toMatchObject([
      { key: "project-structure", value: "Uses pnpm workspaces" },
    ]);
  });

  it("rejects empty observation", async () => {
    const tool = createReflectTool(makeBackend());
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { observation: "   " },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content).toEqual([
      { type: "text", text: "Error: observation must not be empty" },
    ]);
  });

  it("generates unique keys for sequential reflections", async () => {
    const backend = makeBackend();
    const tool = createReflectTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    await tool.execute(
      "call-1",
      { observation: "First" },
      undefined,
      undefined,
      ctx,
    );
    // Ensure at least 1ms between calls so timestamps differ
    await new Promise((r) => setTimeout(r, 2));
    await tool.execute(
      "call-2",
      { observation: "Second" },
      undefined,
      undefined,
      ctx,
    );

    const entries = await backend.recall({
      cwd: "/test/project",
      options: { list: true },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.key).not.toBe(entries[1]!.key);
  });

  describe("global scope", () => {
    it("writes to global scope when scope is global", async () => {
      const backend = makeBackend();
      const tool = createReflectTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "g1",
        { observation: "Global preference", scope: "global" },
        undefined,
        undefined,
        ctx,
      );

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.value).toBe("Global preference");
      expect(entries[0]!.key).toMatch(/^reflection-/);
      expect(entries[0]!.scope).toBe("global");
    });

    it("returns confirmation with (global) label", async () => {
      const tool = createReflectTool(makeBackend());
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "g2",
        {
          observation: "Global learning",
          key: "convention:tabs",
          scope: "global",
        },
        undefined,
        undefined,
        ctx,
      );

      expect(result.content).toEqual([
        { type: "text", text: 'Reflected as "convention:tabs" (global)' },
      ]);
    });
  });

  describe("TTL", () => {
    it("stores entry with TTL (visible before expiry)", async () => {
      const backend = makeBackend();
      const tool = createReflectTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "t1",
        {
          observation: "Temporary learning",
          key: "temp-reflection",
          ttlSeconds: 3600,
        },
        undefined,
        undefined,
        ctx,
      );

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe("temp-reflection");
      expect(entries[0]!.value).toBe("Temporary learning");
    });

    it("entry with ttlSeconds expires and is not recalled", async () => {
      const backend = makeBackend();
      const tool = createReflectTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "t2",
        {
          observation: "Will expire",
          key: "ephemeral",
          ttlSeconds: 0.01,
        },
        undefined,
        undefined,
        ctx,
      );

      await new Promise((r) => setTimeout(r, 20));

      const entries = await backend.recall({
        cwd: "/test/project",
        options: { list: true },
      });
      expect(entries).toHaveLength(0);
    });

    it("reflect with ttlSeconds shows expiry in confirmation", async () => {
      const tool = createReflectTool(makeBackend());
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "t3",
        {
          observation: "Expiring observation",
          key: "timed",
          ttlSeconds: 120,
        },
        undefined,
        undefined,
        ctx,
      );

      expect((result.content[0] as any).text).toContain("expires in 120s");
    });
  });
});
