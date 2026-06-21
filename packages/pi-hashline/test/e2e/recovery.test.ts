/**
 * End-to-end tests: recovery and error scenarios.
 * Verifies stale-edit recovery, unrecoverable stale edits, and multi-section
 * atomicity across the complete tool chain.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditTool, type EditToolDetails } from "../../src/edit.js";
import { InMemorySnapshotStore } from "../../src/lib/hashline/snapshots.js";
import { createReadTool } from "../../src/read.js";
import type { ReadToolDetails } from "../../src/schema.js";
import { createWriteTool } from "../../src/write.js";

let testDir: string;
let snapshots: InMemorySnapshotStore;
let read: ReturnType<typeof createReadTool>;
let edit: ReturnType<typeof createEditTool>;
let write: ReturnType<typeof createWriteTool>;

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

  const prefix = join(tmpdir(), "pi-hashline-e2e-recovery-");
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

describe("E2E recovery scenarios", () => {
  it("reads file, external change on unrelated line, edit is rejected", async () => {
    const ctx = createMockContext(testDir);

    // 1. Write and read the file.
    await write.execute(
      "w1",
      { path: "file.ts", content: "line1\nline2\nline3\nline4\nline5\n" },
      undefined,
      undefined,
      ctx,
    );
    const r1 = await read.execute(
      "r1",
      { path: "file.ts" },
      undefined,
      undefined,
      ctx,
    );
    const details = r1.details as ReadToolDetails;
    const tag = details.fileHash;

    // 2. External change on an unrelated line (line 4).
    const absPath = resolve(testDir, "file.ts");
    await writeFile(
      absPath,
      "line1\nline2\nline3\nCHANGED_EXTERNALLY\nline5\n",
      "utf-8",
    );

    // 3. Edit with stale tag — should be REJECTED (no recovery).
    const result = await edit.execute(
      "e1",
      { edits: `¶file.ts#${tag}\nreplace 2..2:\n+X\n` },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(result.details.files).toHaveLength(0);
    expect(result.details.changed).toBe(false);
    // Should be rejected — no recovery
    expect(text).toMatch(/file changed between read and edit/);

    // File should NOT have been modified.
    const onDisk = await readFile(absPath, "utf-8");
    expect(onDisk).toContain("CHANGED_EXTERNALLY");
  });

  it("external change on exact anchor line → unrecoverable, rejected", async () => {
    const ctx = createMockContext(testDir);

    // 1. Write and read the file.
    await write.execute(
      "w1",
      { path: "exact.ts", content: "line1\nline2\nline3\n" },
      undefined,
      undefined,
      ctx,
    );
    const r1 = await read.execute(
      "r1",
      { path: "exact.ts" },
      undefined,
      undefined,
      ctx,
    );
    const tag = (r1.details as ReadToolDetails).fileHash;

    // 2. External change on the EXACT line the edit targets.
    await writeFile(
      resolve(testDir, "exact.ts"),
      "line1\nLINE2_EXTERNALLY_CHANGED\nline3\n",
      "utf-8",
    );

    // 3. Edit that exact line — should return error.
    const result = await edit.execute(
      "e1",
      {
        edits: `¶exact.ts#${tag}\nreplace 2..2:\n+ATTEMPTED_CHANGE\n`,
      },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(result.details.files).toHaveLength(0);
    expect(result.details.changed).toBe(false);
    expect(text).toMatch(/changed between read and edit/);
    expect(text).toMatch(/\*2:LINE2_EXTERNALLY_CHANGED/);

    // 4. File on disk should be UNCHANGED (edit rejected).
    const content = await readFile(resolve(testDir, "exact.ts"), "utf-8");
    expect(content.replace(/\r\n/g, "\n")).toBe(
      "line1\nLINE2_EXTERNALLY_CHANGED\nline3\n",
    );
  });

  it("head-only insert on stale file succeeds with drift warning", async () => {
    const ctx = createMockContext(testDir);

    await write.execute(
      "w1",
      { path: "drift.ts", content: "original content\n" },
      undefined,
      undefined,
      ctx,
    );
    const r1 = await read.execute(
      "r1",
      { path: "drift.ts" },
      undefined,
      undefined,
      ctx,
    );
    const tag = (r1.details as ReadToolDetails).fileHash;

    // External change.
    await writeFile(
      resolve(testDir, "drift.ts"),
      "externally modified\n",
      "utf-8",
    );

    // Head-only insert should work despite stale tag.
    const e = await edit.execute(
      "e1",
      {
        edits: `¶drift.ts#${tag}\ninsert head:\n+# preamble\n`,
      },
      undefined,
      undefined,
      ctx,
    );

    const editResult = (e.details as EditToolDetails).files[0]!;
    expect(editResult.warnings).toBeDefined();
    expect(
      editResult.warnings!.some((w) => w.includes("snapshot tag was stale")),
    ).toBe(true);

    const content = await readFile(resolve(testDir, "drift.ts"), "utf-8");
    expect(content.replace(/\r\n/g, "\n")).toBe(
      "# preamble\nexternally modified\n",
    );
  });

  it("multi-section edit: both files applied when tags match", async () => {
    const ctx = createMockContext(testDir);

    // 1. Create two files.
    await write.execute(
      "w1",
      { path: "a.ts", content: "a_content\n" },
      undefined,
      undefined,
      ctx,
    );
    await write.execute(
      "w2",
      { path: "b.ts", content: "b_content\n" },
      undefined,
      undefined,
      ctx,
    );

    const ra = await read.execute(
      "ra",
      { path: "a.ts" },
      undefined,
      undefined,
      ctx,
    );
    const rb = await read.execute(
      "rb",
      { path: "b.ts" },
      undefined,
      undefined,
      ctx,
    );
    const tagA = (ra.details as ReadToolDetails).fileHash;
    const tagB = (rb.details as ReadToolDetails).fileHash;

    // 2. Multi-section edit.
    const e = await edit.execute(
      "e1",
      {
        edits: [
          `¶a.ts#${tagA}`,
          "replace 1..1:",
          "+A_CHANGED",
          `¶b.ts#${tagB}`,
          "replace 1..1:",
          "+B_CHANGED",
          "",
        ].join("\n"),
      },
      undefined,
      undefined,
      ctx,
    );

    const details = e.details as EditToolDetails;
    expect(details.files).toHaveLength(2);

    // 3. Verify both files changed.
    const contentA = await readFile(resolve(testDir, "a.ts"), "utf-8");
    const contentB = await readFile(resolve(testDir, "b.ts"), "utf-8");
    expect(contentA.replace(/\r\n/g, "\n")).toBe("A_CHANGED\n");
    expect(contentB.replace(/\r\n/g, "\n")).toBe("B_CHANGED\n");
  });

  it("multi-section edit: second tag stale → first file unmodified (atomic)", async () => {
    const ctx = createMockContext(testDir);

    // Write two files.
    await write.execute(
      "w1",
      { path: "good.ts", content: "good\n" },
      undefined,
      undefined,
      ctx,
    );
    await write.execute(
      "w2",
      { path: "bad.ts", content: "bad\n" },
      undefined,
      undefined,
      ctx,
    );

    const rGood = await read.execute(
      "rg",
      { path: "good.ts" },
      undefined,
      undefined,
      ctx,
    );
    const tagGood = (rGood.details as ReadToolDetails).fileHash;
    // Don't read bad.ts — use a fake tag that won't match.

    // External change on bad.ts so even a real tag would be stale.
    await writeFile(
      resolve(testDir, "bad.ts"),
      "externally modified bad\n",
      "utf-8",
    );

    // Multi-section edit with unrecognized hash in second section — should return error.
    const result = await edit.execute(
      "e1",
      {
        edits: [
          `¶good.ts#${tagGood}`,
          "replace 1..1:",
          "+SHOULD_NOT_APPLY",
          "¶bad.ts#FFFF00",
          "replace 1..1:",
          "+nope",
          "",
        ].join("\n"),
      },
      undefined,
      undefined,
      ctx,
    );

    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(result.details.files).toHaveLength(0);
    expect(result.details.changed).toBe(false);
    expect(text).toMatch(/not from this session/);

    // good.ts should be UNCHANGED (atomic — preflight rejected before any writes).
    const contentGood = await readFile(resolve(testDir, "good.ts"), "utf-8");
    expect(contentGood.replace(/\r\n/g, "\n")).toBe("good\n");
  });

  it("full round-trip: write → read → edit → edit → read with tag chain", async () => {
    const ctx = createMockContext(testDir);

    // 1. Write.
    const w = await write.execute(
      "w1",
      {
        path: "chain.ts",
        content: "import { x } from 'lib';\nconst a = 1;\nconst b = 2;\n",
      },
      undefined,
      undefined,
      ctx,
    );

    // 2. First edit using write tag.
    const tag1 = (w.details as WriteToolDetails).fileHash;
    const e1 = await edit.execute(
      "e1",
      {
        edits: `¶chain.ts#${tag1}\nreplace 2..2:\n+const a = 100;\n`,
      },
      undefined,
      undefined,
      ctx,
    );

    // 3. Second edit using the fresh tag from e1's response.
    const tag2 = (e1.details as EditToolDetails).files[0]!.fileHash;
    const e2 = await edit.execute(
      "e2",
      {
        edits: `¶chain.ts#${tag2}\nreplace 3..3:\n+const b = 200;\n`,
      },
      undefined,
      undefined,
      ctx,
    );

    // 4. Read to verify.
    const r = await read.execute(
      "r1",
      { path: "chain.ts" },
      undefined,
      undefined,
      ctx,
    );
    const finalTag = (e2.details as EditToolDetails).files[0]!.fileHash;
    const readTag = (r.details as ReadToolDetails).fileHash;
    expect(readTag).toBe(finalTag);

    // 5. Verify content.
    const content = await readFile(resolve(testDir, "chain.ts"), "utf-8");
    expect(content.replace(/\r\n/g, "\n")).toBe(
      "import { x } from 'lib';\nconst a = 100;\nconst b = 200;\n",
    );
  });
});
