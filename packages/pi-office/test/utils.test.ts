import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildToolResponse,
  createTempDir,
  resolvePath,
  truncatePreview,
  writeOutput,
} from "../src/utils.js";

describe("resolvePath", () => {
  it("returns path unchanged when no tilde", () => {
    expect(resolvePath("/absolute/path/file.txt")).toBe(
      "/absolute/path/file.txt",
    );
    expect(resolvePath("relative/path")).toBe("relative/path");
  });

  it("expands ~ to home directory", () => {
    // We can't test the exact home dir value since it varies,
    // but we can verify tilde is expanded
    const result = resolvePath("~/docs/file.txt");
    expect(result).not.toContain("~");
    expect(result.endsWith("/docs/file.txt")).toBe(true);
  });
});

describe("createTempDir", () => {
  it("creates a directory under tmpdir with pi-office prefix", async () => {
    const dir = await createTempDir();
    expect(dir.startsWith(tmpdir())).toBe(true);
    expect(dir.includes("pi-office-")).toBe(true);

    // Verify it exists and is empty
    // Verify directory exists (no-op; readFile on a dir would throw)
    // Just clean up
    await rm(dir, { recursive: true, force: true });
  });

  it("creates unique directories on each call", async () => {
    const dir1 = await createTempDir();
    const dir2 = await createTempDir();
    expect(dir1).not.toBe(dir2);

    await rm(dir1, { recursive: true, force: true });
    await rm(dir2, { recursive: true, force: true });
  });
});

describe("writeOutput", () => {
  it("writes content to a file and returns the path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-office-test-"));
    try {
      const filePath = await writeOutput(dir, "test.txt", "hello world");
      expect(filePath).toBe(join(dir, "test.txt"));

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("hello world");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("overwrites existing files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-office-test-"));
    try {
      await writeOutput(dir, "test.txt", "first");
      const filePath = await writeOutput(dir, "test.txt", "second");

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("second");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("truncatePreview", () => {
  it("returns text unchanged when shorter than maxChars", () => {
    expect(truncatePreview("hello", 2000)).toBe("hello");
  });

  it("truncates and appends … when text exceeds maxChars", () => {
    const long = "a".repeat(5000);
    const result = truncatePreview(long, 2000);
    expect(result.length).toBe(2001); // 2000 chars + "…"
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("a".repeat(2000))).toBe(true);
  });

  it("uses default of 2000 chars when maxChars not specified", () => {
    const long = "a".repeat(5000);
    const result = truncatePreview(long);
    expect(result.length).toBe(2001);
  });

  it("does not append … when text exactly matches maxChars", () => {
    const exact = "a".repeat(2000);
    expect(truncatePreview(exact)).toBe(exact);
  });
});

describe("buildToolResponse", () => {
  it("returns a valid AgentToolResult shape", () => {
    const details = { outputPath: "/tmp/test.txt", stats: { chars: 100 } };
    const result = buildToolResponse("preview text", details);

    expect(result.content).toEqual([{ type: "text", text: "preview text" }]);
    expect(result.details).toEqual(details);
  });
});
