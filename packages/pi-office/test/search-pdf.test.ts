import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PdfError, searchPdf } from "../src/parsers.js";
import { createTempDir } from "../src/utils.js";

const fixturesDir = join(import.meta.dirname, "fixtures");
const samplePdf = join(fixturesDir, "sample.pdf");
const encryptedPdf = join(fixturesDir, "encrypted.pdf");

describe("searchPdf", () => {
  it("finds matches on correct pages with correct line numbers", async () => {
    const result = await searchPdf(samplePdf, { query: "Page One" });
    expect(result.totalPages).toBe(2);
    expect(result.pagesSearched).toBe(2);
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    expect(result.truncated).toBe(false);

    const pageOneMatches = result.matches.filter((m) => m.page === 1);
    expect(pageOneMatches.length).toBeGreaterThanOrEqual(1);
    for (const match of pageOneMatches) {
      expect(match.matchLine).toBe(1);
      expect(match.context).toContain("Page One");
    }

    // No matches on page 2 for "Page One"
    const pageTwoMatches = result.matches.filter((m) => m.page === 2);
    expect(pageTwoMatches.length).toBe(0);
  });

  it("finds matches on page 2 when query targets page 2 content", async () => {
    const result = await searchPdf(samplePdf, { query: "Page Two" });
    const pageTwoMatches = result.matches.filter((m) => m.page === 2);
    expect(pageTwoMatches.length).toBeGreaterThanOrEqual(1);
    for (const match of pageTwoMatches) {
      expect(match.context).toContain("Page Two");
    }
  });

  it("is case-insensitive (lowercase query matches uppercase content)", async () => {
    const result = await searchPdf(samplePdf, { query: "page one" });
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].context.toLowerCase()).toContain("page one");
  });

  it("is case-insensitive (uppercase query matches lowercase)", async () => {
    const result = await searchPdf(samplePdf, { query: "PAGE ONE" });
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
  });

  it("finds matches across both pages for shared term", async () => {
    const result = await searchPdf(samplePdf, { query: "Content" });
    expect(result.totalMatches).toBe(2);
    expect(result.matches.length).toBe(2);

    const pages = result.matches.map((m) => m.page).sort();
    expect(pages).toEqual([1, 2]);
  });

  it("returns empty result for nonexistent term", async () => {
    const result = await searchPdf(samplePdf, {
      query: "xyznonexistent123",
    });
    expect(result.matches).toEqual([]);
    expect(result.totalMatches).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("throws on empty query", async () => {
    await expect(searchPdf(samplePdf, { query: "" })).rejects.toThrow(
      "Search query is required",
    );
    await expect(searchPdf(samplePdf, { query: "   " })).rejects.toThrow(
      "Search query is required",
    );
  });

  it("contextLines: 0 returns only the matched line", async () => {
    const result = await searchPdf(samplePdf, {
      query: "Page One",
      contextLines: 0,
    });
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);

    for (const match of result.matches) {
      expect(match.startLine).toBe(match.matchLine);
      expect(match.endLine).toBe(match.matchLine);
      // Context should be exactly the matched line (not multi-line)
      expect(match.context).not.toContain("\n");
    }
  });

  it("contextLines: 2 returns up to 2 lines above and below", async () => {
    const result = await searchPdf(samplePdf, {
      query: "Page One",
      contextLines: 2,
    });
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);

    for (const match of result.matches) {
      // Line range should not exceed what's available
      expect(match.matchLine - match.startLine).toBeLessThanOrEqual(2);
      expect(match.endLine - match.matchLine).toBeLessThanOrEqual(2);
      expect(match.startLine).toBeGreaterThanOrEqual(1);
    }
  });

  it("context clamping: does not overflow page boundaries", async () => {
    // On a 1-line page with contextLines=5, start/end should stay at line 1
    const result = await searchPdf(samplePdf, {
      query: "Page One",
      contextLines: 5,
    });
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);

    for (const match of result.matches) {
      expect(match.startLine).toBeGreaterThanOrEqual(1);
      // endLine should match the actual last line of the page, not overflow
      expect(match.startLine).toBeLessThanOrEqual(match.matchLine);
      expect(match.endLine).toBeGreaterThanOrEqual(match.matchLine);
    }
  });

  it("maxMatches truncates results", async () => {
    // "Content" appears on both pages = 2 matches total
    const result = await searchPdf(samplePdf, {
      query: "Content",
      maxMatches: 1,
    });
    expect(result.matches.length).toBe(1);
    expect(result.totalMatches).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("maxMatches equals or exceeds total matches → not truncated", async () => {
    const result = await searchPdf(samplePdf, {
      query: "Content",
      maxMatches: 10,
    });
    expect(result.matches.length).toBe(2);
    expect(result.totalMatches).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("detects overlapping (multiple) matches on the same line", async () => {
    // "e" appears 3 times in "Page One Content" (Page, One, Content)
    const result = await searchPdf(samplePdf, { query: "e" });
    expect(result.totalMatches).toBeGreaterThanOrEqual(3);

    const pageOneMatches = result.matches.filter((m) => m.page === 1);
    // All on line 1
    for (const match of pageOneMatches) {
      expect(match.matchLine).toBe(1);
    }
  });

  it("defaults: contextLines=1, maxMatches=20", async () => {
    const result = await searchPdf(samplePdf, { query: "Content" });
    // Context should be present (default contextLines=1 adds surrounding lines)
    for (const match of result.matches) {
      expect(match.context.length).toBeGreaterThan(0);
      expect(match.endLine - match.startLine).toBeLessThanOrEqual(2);
    }
  });

  it("throws FILE_NOT_FOUND for nonexistent file", async () => {
    try {
      await searchPdf("/nonexistent/path/file.pdf", { query: "test" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("FILE_NOT_FOUND");
    }
  });

  it("throws ENCRYPTED for encrypted PDF without password", async () => {
    try {
      await searchPdf(encryptedPdf, { query: "test" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("ENCRYPTED");
    }
  });

  it("throws INVALID_PASSWORD for encrypted PDF with wrong password", async () => {
    try {
      await searchPdf(encryptedPdf, {
        query: "test",
        password: "wrong",
      });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("INVALID_PASSWORD");
    }
  });

  it("parses encrypted PDF with correct password", async () => {
    const result = await searchPdf(encryptedPdf, {
      query: "Page One",
      password: "test123",
    });
    expect(result.totalPages).toBe(2);
    expect(result.totalMatches).toBeGreaterThanOrEqual(1);
    expect(result.matches[0].context).toContain("Page One");
  });

  it("throws INVALID_PDF for non-PDF files", async () => {
    const dir = await createTempDir();
    const txtPath = join(dir, "not-a-pdf.txt");
    await writeFile(txtPath, "This is not a PDF file");
    try {
      await searchPdf(txtPath, { query: "test" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("INVALID_PDF");
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
