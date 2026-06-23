import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGrepTool } from "../src/grep.js";
import { InMemorySnapshotStore } from "../src/lib/hashline/snapshots.js";
import type { GrepToolDetails } from "../src/schema.js";

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
  const prefix = join(tmpdir(), "pi-hashline-grep-test-");
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

// rg might not be available in all environments (e.g., CI).
// Use a conditional describe so these tests are skipped gracefully.
const runTests = (() => {
  try {
    const { spawnSync } = require("node:child_process");
    const result = spawnSync("rg", ["--version"], {
      stdio: "ignore",
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!runTests)("grep tool (hashline)", () => {
  it("output includes ¶PATH#TAG header for matching files", async () => {
    await writeTestFile("src/bar.ts", "const foo = 1;\nfoo();\n");
    await writeTestFile("src/baz.ts", "no match here\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "foo", path: "src" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/^¶src\/bar\.ts#[0-9A-F]{6}\n/m);

    // baz.ts should not appear (no matches).
    expect(text).not.toContain("baz.ts");
  });

  it("tags are recorded in SnapshotStore", async () => {
    await writeTestFile("src/app.ts", "const x = 42;\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    await tool.execute(
      "id1",
      { pattern: "const", path: "src" },
      undefined,
      undefined,
      ctx,
    );

    const absPath = resolve(testDir, "src/app.ts");
    const head = snapshots.head(absPath);
    expect(head).not.toBeNull();
    expect(head!.hash).toMatch(/^[0-9A-F]{6}$/);
  });

  it("shows matching lines with hash anchors", async () => {
    await writeTestFile(
      "src/file.ts",
      "line1\nline2\nline3 with match\nline4\nanother match here\n",
    );

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "match", path: "src" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Hash-anchored: expect 4-char hex hash followed by │ and content.
    expect(text).toMatch(/[0-9a-f]{4}│line3 with match/);
    expect(text).toMatch(/[0-9a-f]{4}│another match here/);
  });

  it("returns no matches for non-matching pattern", async () => {
    await writeTestFile("src/file.ts", "hello world\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "nonexistent", path: "src" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/No matches found/);
  });

  it("details include filesWithMatches and totalMatches", async () => {
    await writeTestFile("a.ts", "foo\nbar foo\n");
    await writeTestFile("b.ts", "foo\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "foo", path: "." },
      undefined,
      undefined,
      ctx,
    );

    const details = result.details as GrepToolDetails;
    expect(details.filesWithMatches).toBe(2);
    expect(details.totalMatches).toBe(3);
  });

  it("handles multiple files in the same directory", async () => {
    await writeTestFile("a.ts", "export const a = 1;\n");
    await writeTestFile("b.ts", "export const b = 2;\n");
    await writeTestFile("c.ts", "no export\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "export const", path: "." },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("a.ts");
    expect(text).toContain("b.ts");
    expect(text).not.toContain("c.ts");
  });

  it("uses display-relative paths in headers", async () => {
    await writeTestFile("deep/nested/here.ts", "search me\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "search", path: "deep" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/¶deep\/nested\/here\.ts#[0-9A-F]{6}/);
  });

  it("glob filters files by pattern", async () => {
    await writeTestFile("a.ts", "const x = 1;\n");
    await writeTestFile("b.test.ts", "const y = 2;\n");
    await writeTestFile("c.ts", "const z = 3;\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "const", path: ".", glob: "*.test.ts" },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("b.test.ts");
    expect(text).not.toContain("a.ts");
    expect(text).not.toContain("c.ts");
  });

  it("ignoreCase makes search case-insensitive", async () => {
    await writeTestFile("case.ts", "Hello World\nHELLO\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "hello", path: ".", ignoreCase: true },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Hello");
    expect(text).toContain("HELLO");
  });

  it("ignoreCase false is case-sensitive", async () => {
    await writeTestFile("case2.ts", "Hello World\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "hello", path: "." },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/No matches found/);
  });

  it("literal treats pattern as fixed string", async () => {
    await writeTestFile("regex.ts", "foo.bar\nfooXbar\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "foo.bar", path: ".", literal: true },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Literal: only "foo.bar" matches, not "fooXbar".
    expect(text).toContain("foo.bar");
    expect(text).not.toContain("fooXbar");
  });

  it("context shows surrounding lines", async () => {
    await writeTestFile("ctx.ts", "line1\nline2\nMATCH\nline4\nline5\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "MATCH", path: ".", context: 1 },
      undefined,
      undefined,
      ctx,
    );
    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Hash-anchored: matches show HASH│, context shows HASH-
    expect(text).toMatch(/[0-9a-f]{4}│MATCH/);
    expect(text).toMatch(/[0-9a-f]{4}- line2/);
    expect(text).toMatch(/[0-9a-f]{4}- line4/);
    expect(text).not.toMatch(/[0-9a-f]{4}[│-] line1/); // out of context range
  });

  it("context with overlapping ranges deduplicates lines", async () => {
    await writeTestFile("overlap.ts", "a\nb\nMATCH1\nd\nMATCH2\nf\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "MATCH", path: ".", context: 2 },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    // Both matches with context; ranges may overlap — lines deduplicated.
    const count3 = (text.match(/[0-9a-f]{4}│MATCH1/g) || []).length;
    const count5 = (text.match(/[0-9a-f]{4}│MATCH2/g) || []).length;
    expect(count3).toBe(1);
    expect(count5).toBe(1);
  });

  it("output still includes ¶PATH#TAG headers with context", async () => {
    await writeTestFile("tagctx.ts", "a\nMATCH\nc\n");

    const tool = createGrepTool(snapshots);
    const ctx = createMockContext(testDir);

    const result = await tool.execute(
      "id1",
      { pattern: "MATCH", path: ".", context: 1 },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/^¶tagctx\.ts#[0-9A-F]{6}\n/m);
  });
});
