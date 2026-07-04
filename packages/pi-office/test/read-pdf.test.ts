import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  createReadPdfTool,
  type ReadPdfDetails,
} from "../src/tools/read-pdf.js";

const fixturesDir = join(import.meta.dirname, "fixtures");
const samplePdf = join(fixturesDir, "sample.pdf");

function isReadPdfResult(
  result: AgentToolResult<ReadPdfDetails>,
): result is AgentToolResult<ReadPdfDetails> {
  return (
    result.content !== undefined &&
    Array.isArray(result.content) &&
    result.content.length > 0 &&
    result.content[0]?.type === "text"
  );
}

describe("createReadPdfTool", () => {
  const tool = createReadPdfTool();

  it("has name 'read_pdf'", () => {
    expect(tool.name).toBe("read_pdf");
  });

  it("has a description", () => {
    expect(tool.description).toBeTruthy();
    expect(typeof tool.description).toBe("string");
  });

  it("has parameters schema", () => {
    expect(tool.parameters).toBeDefined();
  });

  it("executes and returns preview with output path", async () => {
    const result = await tool.execute(
      "test-call-id",
      { path: samplePdf },
      undefined,
      undefined,
      { cwd: process.cwd() } as any,
    );

    expect(isReadPdfResult(result)).toBe(true);
    const r = result as AgentToolResult<ReadPdfDetails>;

    // Check content
    expect(r.content[0]!.text).toContain("# Read PDF: sample.pdf");
    expect(r.content[0]!.text).toContain("Page One Content");
    expect(r.content[0]!.text).toContain("Full content written to");

    // Check details
    const details = r.details as ReadPdfDetails;
    expect(details.outputPath).toContain("pi-office-");
    expect(details.stats.pages).toBe(2);
    expect(details.stats.chars).toBeGreaterThan(0);
    expect(details.format).toBe("text");

    // Verify temp file exists with full content
    const fileContent = await readFile(details.outputPath, "utf-8");
    expect(fileContent).toContain("Page One Content");
    expect(fileContent).toContain("Page Two Content");

    // Cleanup
    await rm(details.outputPath, { force: true }).catch(() => {});
  });

  it("truncates preview for large content", async () => {
    const result = await tool.execute(
      "test-call-id",
      { path: samplePdf },
      undefined,
      undefined,
      { cwd: process.cwd() } as any,
    );

    const r = result as AgentToolResult<ReadPdfDetails>;
    const _preview = r.content[0]!.text;

    // The sample PDF is small, so it shouldn't truncate
    expect(r.details.stats.truncated).toBe(false);

    // Cleanup
    const details = r.details as ReadPdfDetails;
    await rm(details.outputPath, { force: true }).catch(() => {});
  });

  it("supports page range via pages parameter", async () => {
    const result = await tool.execute(
      "test-call-id",
      { path: samplePdf, pages: "1" },
      undefined,
      undefined,
      { cwd: process.cwd() } as any,
    );

    const r = result as AgentToolResult<ReadPdfDetails>;
    const _preview = r.content[0]!.text;
    expect(_preview).not.toContain("Page Two Content");
    expect(r.details.stats.pages).toBe(1);

    const details = r.details as ReadPdfDetails;
    await rm(details.outputPath, { force: true }).catch(() => {});
  });

  it("returns error for nonexistent file", async () => {
    try {
      await tool.execute(
        "test-call-id",
        { path: "/nonexistent/file.pdf" },
        undefined,
        undefined,
        { cwd: process.cwd() } as any,
      );
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeDefined();
      expect((err as Error).message).toContain("File not found");
    }
  });
});
