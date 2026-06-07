import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadGlobalMemory,
  loadMemory,
  loadMemoryMeta,
} from "../src/lib/store.js";
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

describe("reflect tool", () => {
  it("registers with the expected name", () => {
    const tool = createReflectTool(baseDir);
    expect(tool.name).toBe("reflect");
  });

  it("stores observation under auto-generated timestamp key", async () => {
    const tool = createReflectTool(baseDir);
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

    const memory = loadMemory("/test/project", baseDir);
    const keys = Object.keys(memory);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^reflection-\d{4}-\d{2}-\d{2}T/);
    expect(memory[keys[0]!]).toBe("This project uses TypeScript");
  });

  it("stores observation under explicit key when provided", async () => {
    const tool = createReflectTool(baseDir);
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

    const memory = loadMemory("/test/project", baseDir);
    expect(memory).toEqual({ "project-structure": "Uses pnpm workspaces" });
  });

  it("rejects empty observation", async () => {
    const tool = createReflectTool(baseDir);
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
    const tool = createReflectTool(baseDir);
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

    const memory = loadMemory("/test/project", baseDir);
    const keys = Object.keys(memory);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  describe("global scope", () => {
    it("writes to global.json when scope is global", async () => {
      const tool = createReflectTool(baseDir);
      const ctx = { cwd: "/test/project" } as any;

      await tool.execute(
        "g1",
        { observation: "Global preference", scope: "global" },
        undefined,
        undefined,
        ctx,
      );

      const globalMem = loadGlobalMemory(baseDir);
      expect(Object.values(globalMem)).toContain("Global preference");
      expect(Object.keys(globalMem)[0]).toMatch(/^reflection-/);
      // Project memory should be unaffected
      const projectMem = loadMemory("/test/project", baseDir);
      expect(projectMem).toEqual({});
    });

    it("returns confirmation with (global) label", async () => {
      const tool = createReflectTool(baseDir);
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
    it("stores TTL metadata alongside the reflection", async () => {
      const tool = createReflectTool(baseDir);
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

      const memory = loadMemory("/test/project", baseDir);
      expect(memory["temp-reflection"]).toBe("Temporary learning");

      const meta = loadMemoryMeta("/test/project", baseDir);
      expect(meta["temp-reflection"]).toBeDefined();
    });

    it("entry with ttlSeconds expires and is not recalled", async () => {
      const tool = createReflectTool(baseDir);
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

      const memory = loadMemory("/test/project", baseDir);
      expect(memory.ephemeral).toBeUndefined();
    });

    it("reflect with ttlSeconds shows expiry in confirmation", async () => {
      const tool = createReflectTool(baseDir);
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
