import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemBackend } from "../src/lib/backends/filesystem.js";
import { createRecallTool } from "../src/recall.js";

let baseDir: string;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-memory-recall-"));
});

afterEach(() => {
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
});

function makeBackend() {
  return new FileSystemBackend({ baseDir });
}

describe("recall tool", () => {
  it("registers with the expected name", () => {
    const tool = createRecallTool(makeBackend());
    expect(tool.name).toBe("recall");
  });

  it("returns exact key match with highest score", async () => {
    const backend = makeBackend();
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "build",
      value: "pnpm build",
    });
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "test",
      value: "vitest",
    });

    const tool = createRecallTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { query: "build" },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("build");
    expect(text).toContain("pnpm build");
    // build should have a higher score than anything else
    expect(text).toMatch(/^\[score: \d+\] \(project\) build:/);
  });

  it("returns keyword-matched results for a partial query", async () => {
    const backend = makeBackend();
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "build-command",
      value: "pnpm run build",
    });
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "test-framework",
      value: "vitest",
    });
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "preferred-formatter",
      value: "biome",
    });

    const tool = createRecallTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { query: "build" },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("build-command");
    expect(text).toContain("pnpm run build");
  });

  it('returns "No relevant memory found" for no-match queries', async () => {
    const backend = makeBackend();
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "foo",
      value: "bar",
    });

    const tool = createRecallTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { query: "xyzzy" },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toBe("No relevant memory found.");
  });

  it("returns all keys in list mode", async () => {
    const backend = makeBackend();
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "a",
      value: "value a",
    });
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "b",
      value: "value b",
    });
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "c",
      value: "value c",
    });

    const tool = createRecallTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { list: true },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("a: value a");
    expect(text).toContain("b: value b");
    expect(text).toContain("c: value c");
  });

  it("shows message when listing empty memory", async () => {
    const tool = createRecallTool(makeBackend());
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { list: true },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toBe("No memory entries found for this project.");
  });

  it("returns usage guidance when neither query nor list provided", async () => {
    const tool = createRecallTool(makeBackend());
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute("call-1", {}, undefined, undefined, ctx);

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Usage:");
  });

  it("scores key matches higher than value matches", async () => {
    const backend = makeBackend();
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "format",
      value: "biome",
    });
    await backend.retain({
      scope: "project",
      cwd: "/test/project",
      key: "tool-preference",
      value: "use format command for formatting",
    });

    const tool = createRecallTool(backend);
    const ctx = { cwd: "/test/project" } as any;

    const result = await tool.execute(
      "call-1",
      { query: "format" },
      undefined,
      undefined,
      ctx,
    );

    const text =
      result.content[0]?.type === "text" ? result.content[0].text : "";
    const lines = text.split("\n");
    // "format" key should appear first
    expect(lines[0]).toContain("format");
  });

  describe("namespace filtering", () => {
    async function seedNamespaceData(backend: FileSystemBackend) {
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "project:build-command",
        value: "pnpm run build",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "project:test-framework",
        value: "vitest",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "user:editor",
        value: "vscode",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "user:prefers-tabs",
        value: "true",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "convention:error-handling",
        value: "Result<T, E> pattern",
      });
    }

    it("returns only keys matching the namespace prefix in search mode", async () => {
      const backend = makeBackend();
      await seedNamespaceData(backend);

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "ns1",
        { query: "build", namespace: "project:" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("build-command");
      expect(text).toContain("pnpm run build");
      // Should NOT include user: entries
      expect(text).not.toContain("editor");
    });

    it("strips namespace prefix from display output", async () => {
      const backend = makeBackend();
      await seedNamespaceData(backend);

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "ns2",
        { query: "editor", namespace: "user:" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      // Display should show "editor" not "user:editor"
      expect(text).toMatch(/\[score: \d+\] \(project\) editor:/);
      expect(text).not.toContain("user:editor");
    });

    it("returns all keys when namespace is omitted (backward compatible)", async () => {
      const backend = makeBackend();
      await seedNamespaceData(backend);

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "ns3",
        { query: "editor" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("user:editor");
    });

    it("filters list mode by namespace", async () => {
      const backend = makeBackend();
      await seedNamespaceData(backend);

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "ns4",
        { list: true, namespace: "project:" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("build-command");
      expect(text).toContain("test-framework");
      expect(text).not.toContain("user:editor");
      expect(text).not.toContain("project:build-command");
    });

    it("shows empty message for namespace with no matches", async () => {
      const backend = makeBackend();
      await seedNamespaceData(backend);

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "ns5",
        { list: true, namespace: "nonexistent:" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toBe(
        'No memory entries found for namespace "nonexistent:".',
      );
    });

    it("shows namespace-specific message for no-match search", async () => {
      const backend = makeBackend();
      await seedNamespaceData(backend);

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;

      const result = await tool.execute(
        "ns6",
        { query: "xyzzy", namespace: "project:" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toBe('No relevant memory found in namespace "project:".');
    });
  });

  describe("global memory merging", () => {
    it("includes global entries alongside project entries", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "user:editor",
        value: "vscode",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "project:build",
        value: "pnpm build",
      });

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;
      const result = await tool.execute(
        "gm1",
        { list: true },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("(global)");
      expect(text).toContain("user:editor");
      expect(text).toContain("(project)");
      expect(text).toContain("project:build");
    });

    it("project entries override global entries with the same key", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "user:editor",
        value: "global-vscode",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "user:editor",
        value: "project-zed",
      });

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;
      const result = await tool.execute(
        "gm2",
        { query: "editor" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      // Should show the project value, not the global one
      expect(text).toContain("project-zed");
      expect(text).not.toContain("global-vscode");
      // Should be labeled as project (overridden)
      expect(text).toContain("(project)");
    });

    it("global entries show (global) label when no project override", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "user:theme",
        value: "tokyonight",
      });

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;
      const result = await tool.execute(
        "gm3",
        { query: "theme" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("(global)");
      expect(text).toContain("user:theme");
    });

    it("global entries are visible across different project cwds", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "global",
        cwd: "/test/project",
        key: "user:editor",
        value: "vscode",
      });

      const tool = createRecallTool(backend);
      // Query from a different project
      const ctx = { cwd: "/other/project" } as any;
      const result = await tool.execute(
        "gm4",
        { query: "editor" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("(global)");
      expect(text).toContain("vscode");
    });
  });

  describe("TTL filtering in recall", () => {
    it("does not return expired entries in search mode", async () => {
      const backend = makeBackend();
      // Store a permanent entry
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "permanent",
        value: "keep",
      });
      // Store an entry with past-expiry TTL using direct file write
      // (backend.remember with negative TTL would set future expiry,
      //  so we write an already-expired entry via a short TTL + wait)
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "ephemeral",
        value: "discard",
        ttlSeconds: 0.01,
      });
      await new Promise((r) => setTimeout(r, 20));

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;
      const result = await tool.execute(
        "ttl1",
        { query: "keep" },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("permanent");
      expect(text).not.toContain("ephemeral");
    });

    it("does not return expired entries in list mode", async () => {
      const backend = makeBackend();
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "keep",
        value: "yes",
      });
      await backend.retain({
        scope: "project",
        cwd: "/test/project",
        key: "stale",
        value: "no",
        ttlSeconds: 0.01,
      });
      await new Promise((r) => setTimeout(r, 20));

      const tool = createRecallTool(backend);
      const ctx = { cwd: "/test/project" } as any;
      const result = await tool.execute(
        "ttl2",
        { list: true },
        undefined,
        undefined,
        ctx,
      );

      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("keep");
      expect(text).not.toContain("stale");
    });
  });
});
