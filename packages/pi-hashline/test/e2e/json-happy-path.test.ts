/**
 * End-to-end tests: JSON format through the complete tool chain.
 * Verifies tag propagation across read → edit → read, write → edit → read,
 * and grep → edit.
 */

import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditTool } from "../../src/edit.js";
import { createGrepTool } from "../../src/grep.js";
import { InMemorySnapshotStore } from "../../src/lib/hashline/snapshots.js";
import { createReadTool } from "../../src/read.js";
import type {
  EditToolDetails,
  ReadToolDetails,
  WriteToolDetails,
} from "../../src/schema.js";
import { createWriteTool } from "../../src/write.js";

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

async function writeTestFile(
  relPath: string,
  content: string,
): Promise<string> {
  const absPath = join(testDir, relPath);
  await mkdir(resolve(absPath, ".."), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(absPath, content, "utf-8");
  return absPath;
}

beforeEach(async () => {
  snapshots = new InMemorySnapshotStore();
  const prefix = join(tmpdir(), "pi-hashline-e2e-json-");
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

describe("E2E JSON format", () => {
  it("read → edit → read: tag chain propagates correctly", async () => {
    const absPath = await writeTestFile(
      "app.ts",
      "const x = 1;\nconst y = 2;\n",
    );
    const ctx = createMockContext(testDir);

    const readTool = createReadTool(snapshots);
    const editTool = createEditTool(snapshots);

    // 1. Read
    const read1 = await readTool.execute(
      "r1",
      { path: "app.ts" },
      undefined,
      undefined,
      ctx,
    );
    const read1Details = read1.details as ReadToolDetails;
    expect(read1Details.fileHash).toMatch(/^[0-9A-F]{6}$/);

    // 2. Read output includes hashline header + hash-anchored lines
    const read1Text = (read1.content[0] as { type: "text"; text: string }).text;
    expect(read1Text).toContain("¶app.ts#");
    expect(read1Text).toContain("│");

    // 3. Edit using hash anchors from read output
    const editResult = await editTool.execute(
      "e1",
      {
        path: "app.ts",
        patch: [{ old_range: [2, 2], new_lines: ["const y = 999;"] }],
      },
      undefined,
      undefined,
      ctx,
    );
    const editDetails = editResult.details as EditToolDetails;
    expect(editDetails.files).toHaveLength(1);
    expect(editDetails.files[0]!.fileHash).toMatch(/^[0-9A-F]{6}$/);
    expect(editDetails.files[0]!.fileHash).not.toBe(read1Details.fileHash);

    // 4. Re-read — tag should be different
    const read2 = await readTool.execute(
      "r2",
      { path: "app.ts" },
      undefined,
      undefined,
      ctx,
    );
    const read2Details = read2.details as ReadToolDetails;
    expect(read2Details.fileHash).not.toBe(read1Details.fileHash);

    // 5. File content is correct
    const fileContent = await readFile(absPath, "utf-8");
    expect(fileContent.replace(/\r\n/g, "\n")).toBe(
      "const x = 1;\nconst y = 999;\n",
    );
  });

  it("write → edit → read: full creation flow", async () => {
    const ctx = createMockContext(testDir);

    const writeTool = createWriteTool(snapshots);
    const editTool = createEditTool(snapshots);
    const readTool = createReadTool(snapshots);

    // 1. Write
    const writeResult = await writeTool.execute(
      "w1",
      { path: "new.ts", content: "// start\nconst a = 1;\n// end\n" },
      undefined,
      undefined,
      ctx,
    );
    const writeDetails = writeResult.details as WriteToolDetails;
    expect(writeDetails.fileHash).toMatch(/^[0-9A-F]{6}$/);

    // 2. Edit using the tag from write
    const editResult = await editTool.execute(
      "e1",
      {
        path: "new.ts",
        patch: [{ old_range: [2, 2], new_lines: ["const a = 42;"] }],
      },
      undefined,
      undefined,
      ctx,
    );
    const editDetails = editResult.details as EditToolDetails;
    expect(editDetails.files).toHaveLength(1);
    expect(editDetails.files[0]!.fileHash).not.toBe(writeDetails.fileHash);

    // 3. Read to verify
    const readResult = await readTool.execute(
      "r1",
      { path: "new.ts" },
      undefined,
      undefined,
      ctx,
    );
    const readDetails = readResult.details as ReadToolDetails;
    expect(readDetails.fileHash).toBe(editDetails.files[0]!.fileHash);
  });

  it("grep → edit: edit file found by grep without re-reading", async () => {
    await writeTestFile("search.ts", "const a = 1;\nconst b = 2;\n");
    const ctx = createMockContext(testDir);

    const grepTool = createGrepTool(snapshots);
    const editTool = createEditTool(snapshots);

    // 1. Grep
    const grepResult = await grepTool.execute(
      "g1",
      { pattern: "const b", path: testDir, literal: true },
      undefined,
      undefined,
      ctx,
    );
    const grepText = (grepResult.content[0] as { type: "text"; text: string })
      .text;
    expect(grepText).toContain("¶search.ts#");

    // 2. Edit using the tag from grep
    const editResult = await editTool.execute(
      "e1",
      {
        path: "search.ts",
        patch: [{ old_range: [2, 2], new_lines: ["const b = 999;"] }],
      },
      undefined,
      undefined,
      ctx,
    );
    const editDetails = editResult.details as EditToolDetails;
    expect(editDetails.files).toHaveLength(1);

    // 3. Verify file content
    const absPath = resolve(testDir, "search.ts");
    const fileContent = await readFile(absPath, "utf-8");
    expect(fileContent.replace(/\r\n/g, "\n")).toBe(
      "const a = 1;\nconst b = 999;\n",
    );
  });
});
