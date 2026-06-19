/**
 * End-to-end tests: happy path through the complete tool chain.
 * Verifies tag propagation across read → edit → read, write → edit → read,
 * and grep → edit.
 */

import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditTool, type EditToolDetails } from "../../src/edit.js";
import { createGrepTool, type GrepToolDetails } from "../../src/grep.js";
import { InMemorySnapshotStore } from "../../src/lib/hashline/snapshots.js";
import { createReadTool } from "../../src/read.js";
import type { ReadToolDetails } from "../../src/schema.js";
import { createWriteTool, type WriteToolDetails } from "../../src/write.js";

let testDir: string;
let snapshots: InMemorySnapshotStore;
let read: ReturnType<typeof createReadTool>;
let edit: ReturnType<typeof createEditTool>;
let write: ReturnType<typeof createWriteTool>;
let grep: ReturnType<typeof createGrepTool>;

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
  read = createReadTool(snapshots);
  edit = createEditTool(snapshots);
  write = createWriteTool(snapshots);
  grep = createGrepTool(snapshots);

  const prefix = join(tmpdir(), "pi-hashline-e2e-");
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

describe("E2E happy path", () => {
  it("read → edit → read: tag chain propagates correctly", async () => {
    const ctx = createMockContext(testDir);

    // 1. Write initial file.
    const w = await write.execute(
      "w1",
      { path: "app.ts", content: "const x = 1;\nconst y = 2;\n" },
      undefined,
      undefined,
      ctx,
    );
    const writeTag = (w.details as WriteToolDetails).fileHash;

    // 2. Read to verify tag consistency.
    const r1 = await read.execute(
      "r1",
      { path: "app.ts" },
      undefined,
      undefined,
      ctx,
    );
    const readTag1 = (r1.details as ReadToolDetails).fileHash;
    expect(readTag1).toBe(writeTag);

    // 3. Edit using the read tag.
    const e = await edit.execute(
      "e1",
      {
        edits: `¶app.ts#${readTag1}\nreplace 2..2:\n+const y = 999;\n`,
      },
      undefined,
      undefined,
      ctx,
    );
    const editResult = (e.details as EditToolDetails).files[0]!;
    const editTag = editResult.fileHash;
    expect(editTag).not.toBe(readTag1); // tag changed

    // 4. Read again — tag should match edit result.
    const r2 = await read.execute(
      "r2",
      { path: "app.ts" },
      undefined,
      undefined,
      ctx,
    );
    const readTag2 = (r2.details as ReadToolDetails).fileHash;
    expect(readTag2).toBe(editTag);

    // 5. Verify file content on disk.
    const content = await readFile(resolve(testDir, "app.ts"), "utf-8");
    expect(content.replace(/\r\n/g, "\n")).toBe(
      "const x = 1;\nconst y = 999;\n",
    );
  });

  it("write → edit → read: full creation flow", async () => {
    const ctx = createMockContext(testDir);

    // 1. Write a new file, get its tag.
    const w = await write.execute(
      "w1",
      { path: "new.ts", content: "line1\nline2\nline3\n" },
      undefined,
      undefined,
      ctx,
    );
    const writeTag = (w.details as WriteToolDetails).fileHash;

    // 2. Immediately edit using the write tag (no read needed).
    const e = await edit.execute(
      "e1",
      {
        edits:
          `¶new.ts#${writeTag}\n` +
          "replace 2..2:\n" +
          "+LINE_TWO_CHANGED\n" +
          "insert tail:\n" +
          "+line4\n",
      },
      undefined,
      undefined,
      ctx,
    );

    // 3. Read to verify final state.
    const r = await read.execute(
      "r1",
      { path: "new.ts" },
      undefined,
      undefined,
      ctx,
    );

    const details = r.details as ReadToolDetails;
    const editResult = (e.details as EditToolDetails).files[0]!;
    expect(details.fileHash).toBe(editResult.fileHash);

    // 4. Verify disk content.
    const content = await readFile(resolve(testDir, "new.ts"), "utf-8");
    expect(content.replace(/\r\n/g, "\n")).toBe(
      "line1\nLINE_TWO_CHANGED\nline3\nline4\n",
    );
  });

  it("grep → edit: edit file found by grep without re-reading", async () => {
    const ctx = createMockContext(testDir);

    // 1. Write two files.
    await write.execute(
      "w1",
      { path: "a.ts", content: "export const a = 1;\n" },
      undefined,
      undefined,
      ctx,
    );
    await write.execute(
      "w2",
      { path: "b.ts", content: "export const b = 2;\n" },
      undefined,
      undefined,
      ctx,
    );

    // 2. Grep for "export const".
    const g = await grep.execute(
      "g1",
      { pattern: "export const", path: "." },
      undefined,
      undefined,
      ctx,
    );
    const grepFiles = (g.details as GrepToolDetails).files;
    expect(grepFiles.length).toBeGreaterThanOrEqual(2);

    // 3. Edit b.ts using the grep tag — no read needed.
    const bFile = grepFiles.find((f) => f.path === "b.ts");
    expect(bFile).toBeDefined();

    await edit.execute(
      "e1",
      {
        edits:
          `¶b.ts#${bFile!.fileHash}\n` +
          "replace 1..1:\n" +
          "+export const b = 999;\n",
      },
      undefined,
      undefined,
      ctx,
    );

    // 4. Verify file changed on disk.
    const content = await readFile(resolve(testDir, "b.ts"), "utf-8");
    expect(content.replace(/\r\n/g, "\n")).toBe("export const b = 999;\n");
  });

  it("multiple reads of the same file return the same tag", async () => {
    const ctx = createMockContext(testDir);

    await write.execute(
      "w1",
      { path: "stable.ts", content: "hello\n" },
      undefined,
      undefined,
      ctx,
    );

    const r1 = await read.execute(
      "r1",
      { path: "stable.ts" },
      undefined,
      undefined,
      ctx,
    );
    const r2 = await read.execute(
      "r2",
      { path: "stable.ts" },
      undefined,
      undefined,
      ctx,
    );
    const r3 = await read.execute(
      "r3",
      { path: "stable.ts" },
      undefined,
      undefined,
      ctx,
    );

    const t1 = (r1.details as ReadToolDetails).fileHash;
    const t2 = (r2.details as ReadToolDetails).fileHash;
    const t3 = (r3.details as ReadToolDetails).fileHash;
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
  });

  it("offset/limit read still returns the same tag", async () => {
    const ctx = createMockContext(testDir);

    await write.execute(
      "w1",
      {
        path: "big.ts",
        content: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n",
      },
      undefined,
      undefined,
      ctx,
    );

    const full = await read.execute(
      "r1",
      { path: "big.ts" },
      undefined,
      undefined,
      ctx,
    );
    const sliced = await read.execute(
      "r2",
      { path: "big.ts", offset: 3, limit: 2 },
      undefined,
      undefined,
      ctx,
    );

    const fullTag = (full.details as ReadToolDetails).fileHash;
    const slicedTag = (sliced.details as ReadToolDetails).fileHash;
    // Same file → same tag regardless of offset/limit.
    expect(slicedTag).toBe(fullTag);
  });

  it("tag survives session-less use (no session state required)", async () => {
    const ctx = createMockContext(testDir);

    // All tools work purely from the SnapshotStore — no session state.
    await write.execute(
      "w1",
      { path: "stateless.ts", content: "data\n" },
      undefined,
      undefined,
      ctx,
    );

    const r = await read.execute(
      "r1",
      { path: "stateless.ts" },
      undefined,
      undefined,
      ctx,
    );

    const text = (r.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/^¶stateless\.ts#[0-9A-F]{4}\n/);
  });
});
