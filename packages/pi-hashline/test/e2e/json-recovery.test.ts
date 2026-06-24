/**
 * End-to-end recovery tests: JSON format error scenarios.
 * Verifies stale-tag rejection and drift handling.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditTool } from "../../src/edit.js";
import { InMemorySnapshotStore } from "../../src/lib/hashline/snapshots.js";
import { createReadTool } from "../../src/read.js";
import type { EditToolDetails, ReadToolDetails } from "../../src/schema.js";

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

describe("E2E JSON recovery", () => {
  it("reads file, external change on targeted line, edit is rejected", async () => {
    const absPath = resolve(testDir, "mod.ts");
    await writeFile(absPath, "line1\nline2\nline3\n", "utf-8");
    const ctx = createMockContext(testDir);

    const readTool = createReadTool(snapshots);
    const editTool = createEditTool(snapshots);

    // 1. Read — records snapshot and gives us hash anchors
    await readTool.execute("r1", { path: "mod.ts" }, undefined, undefined, ctx);

    // Compute hash anchor for line 1 directly
    const { computeLineHashes } = await import(
      "../../src/lib/hashline/hash.js"
    );
    const hashes = computeLineHashes("line1\nline2\nline3\n");
    const firstLineHash = hashes[0];

    // 2. External change on line 1 — the line being edited
    await writeFile(absPath, "CHANGED\nline2\nline3\n", "utf-8");

    // 3. Edit using hash anchors from read — should fail (stale hash)
    const editResult = await editTool.execute(
      "e1",
      {
        path: "mod.ts",
        patch: [
          { old_range: [firstLineHash!, firstLineHash!], new_lines: ["NEW"] },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    const details = editResult.details as EditToolDetails;
    expect(details.files).toHaveLength(0);
    expect(details.changed).toBe(false);
    const text = (editResult.content[0] as { type: "text"; text: string }).text;
    expect(text).toMatch(/E_STALE_ANCHOR/);
  });

  it("stale tag: re-read after rejection gives fresh anchors", async () => {
    const absPath = resolve(testDir, "chain.ts");
    await writeFile(
      absPath,
      "const a = 1;\nconst b = 2;\nconst c = 3;\n",
      "utf-8",
    );
    const ctx = createMockContext(testDir);

    const readTool = createReadTool(snapshots);
    const editTool = createEditTool(snapshots);

    // 1. Read
    const read1 = await readTool.execute(
      "r1",
      { path: "chain.ts" },
      undefined,
      undefined,
      ctx,
    );
    const read1Details = read1.details as ReadToolDetails;

    // Compute hash anchor for line 2 of the original content
    const { computeLineHashes } = await import(
      "../../src/lib/hashline/hash.js"
    );
    const hashes = computeLineHashes(
      "const a = 1;\nconst b = 2;\nconst c = 3;\n",
    );
    const line2Hash = hashes[1];

    // 2. External change
    await writeFile(
      absPath,
      "const a = 1;\nconst B = 999;\nconst c = 3;\n",
      "utf-8",
    );

    // 3. Edit fails (stale hash)
    const edit1 = await editTool.execute(
      "e1",
      {
        path: "chain.ts",
        patch: [
          { old_range: [line2Hash!, line2Hash!], new_lines: ["const b = 2;"] },
        ],
      },
      undefined,
      undefined,
      ctx,
    );
    expect((edit1.details as EditToolDetails).files).toHaveLength(0);

    // 4. Re-read to get fresh tag
    const read2 = await readTool.execute(
      "r2",
      { path: "chain.ts" },
      undefined,
      undefined,
      ctx,
    );
    expect(read2.details).toBeDefined();
    const read2Details = read2.details as ReadToolDetails;
    expect(read2Details.fileHash).not.toBe(read1Details.fileHash);

    // 5. Edit with fresh tag succeeds
    const edit2 = await editTool.execute(
      "e2",
      {
        path: "chain.ts",
        patch: [{ old_range: [2, 2], new_lines: ["const b = 2;"] }],
      },
      undefined,
      undefined,
      ctx,
    );
    const edit2Details = edit2.details as EditToolDetails;
    expect(edit2Details.files).toHaveLength(1);

    // 6. File content is correct
    const fileContent = await readFile(absPath, "utf-8");
    expect(fileContent.replace(/\r\n/g, "\n")).toBe(
      "const a = 1;\nconst b = 2;\nconst c = 3;\n",
    );
  });

  it("full round-trip: write → read → edit → edit → read with tag chain", async () => {
    const ctx = createMockContext(testDir);

    const { createWriteTool } = await import("../../src/write.js");
    const writeTool = createWriteTool(snapshots);
    const readTool = createReadTool(snapshots);
    const editTool = createEditTool(snapshots);

    // 1. Write
    const _w = await writeTool.execute(
      "w1",
      { path: "roundtrip.ts", content: "// step 0\nlet x = 0;\n// end\n" },
      undefined,
      undefined,
      ctx,
    );

    // 2. Read
    const r1 = await readTool.execute(
      "r1",
      { path: "roundtrip.ts" },
      undefined,
      undefined,
      ctx,
    );
    const r1Details = r1.details as ReadToolDetails;

    // 3. First edit
    const e1 = await editTool.execute(
      "e1",
      {
        path: "roundtrip.ts",
        patch: [{ old_range: [2, 2], new_lines: ["let x = 1;"] }],
      },
      undefined,
      undefined,
      ctx,
    );
    const e1Details = e1.details as EditToolDetails;
    expect(e1Details.files).toHaveLength(1);
    expect(e1Details.files[0]!.fileHash).not.toBe(r1Details.fileHash);

    // 4. Second edit (anchors from fresh read via edit response wouldn't work — need re-read)
    const r2 = await readTool.execute(
      "r2",
      { path: "roundtrip.ts" },
      undefined,
      undefined,
      ctx,
    );
    const r2Details = r2.details as ReadToolDetails;
    expect(r2Details.fileHash).toBe(e1Details.files[0]!.fileHash);

    const e2 = await editTool.execute(
      "e2",
      {
        path: "roundtrip.ts",
        patch: [{ old_range: [1, 1], new_lines: ["// step 2"] }],
      },
      undefined,
      undefined,
      ctx,
    );
    const e2Details = e2.details as EditToolDetails;
    expect(e2Details.files[0]!.fileHash).not.toBe(r2Details.fileHash);

    // 5. Final read
    const r3 = await readTool.execute(
      "r3",
      { path: "roundtrip.ts" },
      undefined,
      undefined,
      ctx,
    );
    const r3Details = r3.details as ReadToolDetails;
    expect(r3Details.fileHash).toBe(e2Details.files[0]!.fileHash);

    // 6. Verify content
    const absPath = resolve(testDir, "roundtrip.ts");
    const content = await readFile(absPath, "utf-8");
    expect(content.replace(/\r\n/g, "\n")).toBe(
      "// step 2\nlet x = 1;\n// end\n",
    );
  });
});
