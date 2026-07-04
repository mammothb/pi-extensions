import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DocxError,
  PdfError,
  parseDocx,
  parsePageRanges,
  parsePdf,
  parseXlsx,
  searchDocx,
  searchXlsx,
  XlsxError,
} from "../src/parsers.js";
import { createTempDir } from "../src/utils.js";

const fixturesDir = join(import.meta.dirname, "fixtures");
const samplePdf = join(fixturesDir, "sample.pdf");
const sampleDocx = join(fixturesDir, "sample.docx");
const sampleXlsx = join(fixturesDir, "sample.xlsx");

describe("parsePageRanges", () => {
  it("returns all pages when spec is undefined", () => {
    expect(parsePageRanges(undefined, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns all pages when spec is empty string", () => {
    expect(parsePageRanges("", 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses a single page", () => {
    expect(parsePageRanges("3", 5)).toEqual([3]);
  });

  it("parses a page range", () => {
    expect(parsePageRanges("2-4", 5)).toEqual([2, 3, 4]);
  });

  it("parses multiple ranges and single pages", () => {
    expect(parsePageRanges("1-2,5,7-9", 10)).toEqual([1, 2, 5, 7, 8, 9]);
  });

  it("clamps ranges to totalPages", () => {
    expect(parsePageRanges("3-10", 5)).toEqual([3, 4, 5]);
  });

  it("skips pages outside valid range", () => {
    expect(parsePageRanges("10", 5)).toEqual([]);
  });

  it("handles whitespace in spec", () => {
    expect(parsePageRanges(" 1 , 3 - 5 ", 5)).toEqual([1, 3, 4, 5]);
  });

  it("returns deduplicated pages", () => {
    expect(parsePageRanges("1-3,2-4", 5)).toEqual([1, 2, 3, 4]);
  });
});

describe("parsePdf", () => {
  it("extracts text from all pages of a valid PDF", async () => {
    const result = await parsePdf(samplePdf);
    expect(result.totalPages).toBe(2);
    expect(result.text).toContain("Page One Content");
    expect(result.text).toContain("Page Two Content");
  });

  it("filters by page range", async () => {
    const result = await parsePdf(samplePdf, { pages: "1" });
    expect(result.totalPages).toBe(1);
    expect(result.text).toContain("Page One Content");
    expect(result.text).not.toContain("Page Two Content");
  });

  it("applies maxPages limit", async () => {
    const result = await parsePdf(samplePdf, { maxPages: 1 });
    expect(result.totalPages).toBe(1);
    expect(result.text).toContain("Page One Content");
    expect(result.text).not.toContain("Page Two Content");
  });

  it("writes output to a temp file", async () => {
    const dir = await createTempDir();
    try {
      const result = await parsePdf(samplePdf);
      // Output contains page markers
      expect(result.text).toContain("--- Page 1 ---");
      expect(result.text).toContain("--- Page 2 ---");
      expect(result.totalPages).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("throws FILE_NOT_FOUND for nonexistent file", async () => {
    try {
      await parsePdf("/nonexistent/path/file.pdf");
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("FILE_NOT_FOUND");
    }
  });

  it("throws PARSE_FAILED for directories (read error, not ENOENT)", async () => {
    try {
      await parsePdf(tmpdir());
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("PARSE_FAILED");
    }
  });

  it("throws INVALID_PDF for non-PDF files", async () => {
    const dir = await createTempDir();
    const txtPath = join(dir, "not-a-pdf.txt");
    await writeFile(txtPath, "This is not a PDF file");
    try {
      await parsePdf(txtPath);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("INVALID_PDF");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("throws ENCRYPTED for encrypted PDF without password", async () => {
    const encryptedPdf = join(fixturesDir, "encrypted.pdf");
    try {
      await parsePdf(encryptedPdf);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("ENCRYPTED");
    }
  });

  it("throws INVALID_PASSWORD for encrypted PDF with wrong password", async () => {
    const encryptedPdf = join(fixturesDir, "encrypted.pdf");
    try {
      await parsePdf(encryptedPdf, { password: "wrong" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(PdfError);
      expect((err as PdfError).code).toBe("INVALID_PASSWORD");
    }
  });

  it("parses encrypted PDF with correct password", async () => {
    const encryptedPdf = join(fixturesDir, "encrypted.pdf");
    const result = await parsePdf(encryptedPdf, { password: "test123" });
    expect(result.totalPages).toBe(2);
    expect(result.text).toContain("Page One Content");
    expect(result.text).toContain("Page Two Content");
  });
});

describe("parseDocx", () => {
  it("converts DOCX to non-empty markdown", async () => {
    const result = await parseDocx(sampleDocx);
    expect(result.markdown).toBeTruthy();
    expect(result.markdown.length).toBeGreaterThan(0);
  });

  it("preserves heading text", async () => {
    const result = await parseDocx(sampleDocx);
    expect(result.markdown).toContain("Document Title");
  });

  it("preserves bold formatting", async () => {
    const result = await parseDocx(sampleDocx);
    expect(result.markdown).toMatch(/\*\*Bold\*\*/);
  });

  it("preserves italic formatting", async () => {
    const result = await parseDocx(sampleDocx);
    expect(result.markdown).toMatch(/[*_]italic[*_]/);
  });

  it("preserves bullet list items", async () => {
    const result = await parseDocx(sampleDocx);
    expect(result.markdown).toContain("First bullet item");
    expect(result.markdown).toContain("Second bullet item");
  });

  it("preserves table content", async () => {
    const result = await parseDocx(sampleDocx);
    expect(result.markdown).toContain("Name");
    expect(result.markdown).toContain("Value");
    expect(result.markdown).toContain("Alpha");
    expect(result.markdown).toContain("1");
  });

  it("returns warnings array", async () => {
    const result = await parseDocx(sampleDocx);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("throws FILE_NOT_FOUND for nonexistent file", async () => {
    try {
      await parseDocx("/nonexistent/path/file.docx");
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DocxError);
      expect((err as DocxError).code).toBe("FILE_NOT_FOUND");
    }
  });

  it("throws INVALID_DOCX for non-DOCX files", async () => {
    const dir = await createTempDir();
    const txtPath = join(dir, "not-a-docx.txt");
    await writeFile(txtPath, "This is not a DOCX file");
    try {
      await parseDocx(txtPath);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DocxError);
      expect((err as DocxError).code).toBe("INVALID_DOCX");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("throws INVALID_DOCX for a PDF file", async () => {
    try {
      await parseDocx(samplePdf);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DocxError);
      expect((err as DocxError).code).toBe("INVALID_DOCX");
    }
  });
});

describe("searchDocx", () => {
  it("finds text that exists in the document", async () => {
    const result = await searchDocx(sampleDocx, { query: "Document" });
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.totalMatches).toBeGreaterThan(0);
  });

  it("finds multiple occurrences", async () => {
    const result = await searchDocx(sampleDocx, { query: "bullet" });
    expect(result.totalMatches).toBeGreaterThanOrEqual(2);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
  });

  it("matches case-insensitively", async () => {
    const resultUpper = await searchDocx(sampleDocx, { query: "DOCUMENT" });
    const resultLower = await searchDocx(sampleDocx, { query: "document" });
    expect(resultUpper.totalMatches).toBe(resultLower.totalMatches);
    expect(resultUpper.totalMatches).toBeGreaterThan(0);
  });

  it("returns empty matches for nonexistent term", async () => {
    const result = await searchDocx(sampleDocx, { query: "xyznonexistent" });
    expect(result.totalMatches).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.totalChars).toBeGreaterThan(0);
  });

  it("respects contextChars", async () => {
    const result = await searchDocx(sampleDocx, {
      query: "Value",
      contextChars: 50,
    });
    expect(result.matches.length).toBeGreaterThan(0);
    for (const match of result.matches) {
      // context length should be at most contextChars + query.length
      expect(match.context.length).toBeLessThanOrEqual(50 + "Value".length);
    }
  });

  it("respects maxMatches and reports truncation", async () => {
    const result = await searchDocx(sampleDocx, { query: "e", maxMatches: 2 });
    expect(result.matches.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });

  it("does not truncate when maxMatches exceeds total matches", async () => {
    const result = await searchDocx(sampleDocx, {
      query: "Document Title",
      maxMatches: 100,
    });
    expect(result.truncated).toBe(false);
  });

  it("records correct charOffset", async () => {
    const result = await searchDocx(sampleDocx, { query: "Document Title" });
    expect(result.matches.length).toBeGreaterThan(0);
    const match = result.matches[0];
    expect(result.totalChars).toBeGreaterThan(0);
    expect(match.charOffset).toBeGreaterThanOrEqual(0);
    expect(match.charOffset).toBeLessThan(result.totalChars);
  });

  it("throws PARSE_FAILED for empty query", async () => {
    try {
      await searchDocx(sampleDocx, { query: "" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DocxError);
      expect((err as DocxError).code).toBe("PARSE_FAILED");
    }
  });

  it("throws FILE_NOT_FOUND for nonexistent file", async () => {
    try {
      await searchDocx("/nonexistent/path/file.docx", { query: "test" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DocxError);
      expect((err as DocxError).code).toBe("FILE_NOT_FOUND");
    }
  });

  it("throws INVALID_DOCX for non-DOCX files", async () => {
    try {
      await searchDocx(samplePdf, { query: "test" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DocxError);
      expect((err as DocxError).code).toBe("INVALID_DOCX");
    }
  });

  it("defaults contextChars to 100", async () => {
    const result = await searchDocx(sampleDocx, { query: "Document Title" });
    expect(result.matches.length).toBeGreaterThan(0);
    // With default 100 context, match context should be at most 100 + query length
    const match = result.matches[0];
    expect(match.context.length).toBeLessThanOrEqual(
      100 + "Document Title".length,
    );
  });
});

describe("parseXlsx", () => {
  describe("index mode (no sheet param)", () => {
    it("returns all sheet names", async () => {
      const result = await parseXlsx(sampleXlsx);
      expect(result.sheetNames).toEqual(["Summary", "Budget", "Empty"]);
    });

    it("returns preview for every sheet", async () => {
      const result = await parseXlsx(sampleXlsx);
      expect(result.sheets).toHaveLength(3);
    });

    it("preview rows limited by maxRows", async () => {
      const result = await parseXlsx(sampleXlsx, { maxRows: 2 });
      for (const sheet of result.sheets) {
        expect(sheet.data.length).toBeLessThanOrEqual(2);
      }
    });

    it("defaults maxRows to 10", async () => {
      const result = await parseXlsx(sampleXlsx);
      for (const sheet of result.sheets) {
        expect(sheet.data.length).toBeLessThanOrEqual(10);
      }
    });

    it("metadata rows reflects total (not truncated)", async () => {
      const result = await parseXlsx(sampleXlsx, { maxRows: 1 });
      const summary = result.sheets.find((s) => s.name === "Summary")!;
      expect(summary.rows).toBe(2);
      expect(summary.data).toHaveLength(1);
    });

    it("metadata cols matches fixture", async () => {
      const result = await parseXlsx(sampleXlsx);
      const summary = result.sheets.find((s) => s.name === "Summary")!;
      expect(summary.cols).toBe(4);
      const budget = result.sheets.find((s) => s.name === "Budget")!;
      expect(budget.cols).toBe(3);
    });

    it("headers correct for Summary sheet", async () => {
      const result = await parseXlsx(sampleXlsx);
      const summary = result.sheets.find((s) => s.name === "Summary")!;
      expect(summary.headers).toEqual(["Category", "Q1", "Q2", "Q3"]);
    });

    it("data is array-of-objects keyed by header", async () => {
      const result = await parseXlsx(sampleXlsx);
      const summary = result.sheets.find((s) => s.name === "Summary")!;
      expect(summary.data[0].Category).toBe("Revenue");
      expect(summary.data[0].Q1).toBe("1.2M");
      expect(summary.data[1].Category).toBe("Costs");
      expect(summary.data[1].Q3).toBe("1.0M");
    });

    it("empty sheet has headers but no data", async () => {
      const result = await parseXlsx(sampleXlsx);
      const empty = result.sheets.find((s) => s.name === "Empty")!;
      expect(empty.headers).toEqual(["Column A", "Column B"]);
      expect(empty.data).toEqual([]);
      expect(empty.rows).toBe(0);
    });

    it("sheet field is undefined in index mode", async () => {
      const result = await parseXlsx(sampleXlsx);
      expect(result.sheet).toBeUndefined();
    });
  });

  describe("sheet mode (sheet param given)", () => {
    it("returns only requested sheet in sheet field", async () => {
      const result = await parseXlsx(sampleXlsx, { sheet: "Budget" });
      expect(result.sheet).toBeDefined();
      expect(result.sheet!.name).toBe("Budget");
      expect(result.sheets).toEqual([]);
    });

    it("full data returned (not truncated)", async () => {
      const result = await parseXlsx(sampleXlsx, { sheet: "Summary" });
      expect(result.sheet!.data).toHaveLength(2);
      expect(result.sheet!.rows).toBe(2);
    });

    it("metadata correct", async () => {
      const result = await parseXlsx(sampleXlsx, { sheet: "Budget" });
      expect(result.sheet!.rows).toBe(3);
      expect(result.sheet!.cols).toBe(3);
      expect(result.sheet!.headers).toEqual(["Dept", "Alloc", "Spent"]);
    });

    it("ignores maxRows in sheet mode", async () => {
      const result = await parseXlsx(sampleXlsx, {
        sheet: "Summary",
        maxRows: 1,
      });
      expect(result.sheet!.data).toHaveLength(2);
    });
  });

  describe("error handling", () => {
    it("throws SHEET_NOT_FOUND for invalid sheet name", async () => {
      try {
        await parseXlsx(sampleXlsx, { sheet: "Nonexistent" });
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(XlsxError);
        expect((err as XlsxError).code).toBe("SHEET_NOT_FOUND");
        expect((err as XlsxError).message).toContain("Available sheets");
      }
    });

    it("throws FILE_NOT_FOUND for nonexistent file", async () => {
      try {
        await parseXlsx("/nonexistent/path/file.xlsx");
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(XlsxError);
        expect((err as XlsxError).code).toBe("FILE_NOT_FOUND");
      }
    });

    it("throws INVALID_XLSX for non-XLSX file", async () => {
      try {
        await parseXlsx(samplePdf);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(XlsxError);
        expect((err as XlsxError).code).toBe("INVALID_XLSX");
      }
    });

    it("throws PARSE_FAILED for a directory path", async () => {
      try {
        await parseXlsx(tmpdir());
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(XlsxError);
        expect((err as XlsxError).code).toBe("PARSE_FAILED");
      }
    });
  });
});

describe("searchXlsx", () => {
  it("finds term in a single sheet", async () => {
    const result = await searchXlsx(sampleXlsx, { query: "Revenue" });
    expect(result.totalMatches).toBe(1);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].sheet).toBe("Summary");
    expect(result.matches[0].row).toBe(2);
    expect(result.matches[0].cells.Category).toBe("Revenue");
  });

  it("finds term across multiple sheets", async () => {
    // "0" appears in Summary (0.8M, 0.9M, 1.0M) and Budget (500K, 200K, 320K, 150K, 140K)
    const result = await searchXlsx(sampleXlsx, { query: "0" });
    expect(result.totalMatches).toBeGreaterThanOrEqual(4);
    const sheets = new Set(result.matches.map((m) => m.sheet));
    expect(sheets.has("Summary")).toBe(true);
    expect(sheets.has("Budget")).toBe(true);
  });

  it("matches case-insensitively", async () => {
    const upper = await searchXlsx(sampleXlsx, { query: "REVENUE" });
    const lower = await searchXlsx(sampleXlsx, { query: "revenue" });
    expect(upper.totalMatches).toBe(lower.totalMatches);
    expect(upper.totalMatches).toBe(1);
  });

  it("returns empty matches for nonexistent term", async () => {
    const result = await searchXlsx(sampleXlsx, {
      query: "xyznonexistent",
    });
    expect(result.totalMatches).toBe(0);
    expect(result.matches).toEqual([]);
    expect(result.totalSheets).toBe(3);
    expect(result.sheetsSearched).toBe(3);
  });

  it("limits search to a specific sheet", async () => {
    const result = await searchXlsx(sampleXlsx, {
      query: "e",
      sheet: "Budget",
    });
    expect(result.sheetsSearched).toBe(1);
    for (const match of result.matches) {
      expect(match.sheet).toBe("Budget");
    }
    // "e" matches Engineering, Design, Marketing
    expect(result.totalMatches).toBe(3);
  });

  it("handles empty sheet with no data rows", async () => {
    const result = await searchXlsx(sampleXlsx, {
      query: "anything",
      sheet: "Empty",
    });
    expect(result.totalMatches).toBe(0);
    expect(result.matches).toEqual([]);
  });

  it("row numbering is 1-indexed with header as row 1", async () => {
    const result = await searchXlsx(sampleXlsx, { query: "Revenue" });
    expect(result.matches[0].row).toBe(2);
  });

  it("respects maxMatches and reports truncation", async () => {
    const result = await searchXlsx(sampleXlsx, {
      query: "e",
      maxMatches: 2,
    });
    expect(result.matches.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });

  it("does not truncate when maxMatches exceeds total", async () => {
    const result = await searchXlsx(sampleXlsx, {
      query: "Revenue",
      maxMatches: 100,
    });
    expect(result.truncated).toBe(false);
  });

  it("throws SHEET_NOT_FOUND for invalid sheet name", async () => {
    try {
      await searchXlsx(sampleXlsx, {
        query: "test",
        sheet: "Nonexistent",
      });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(XlsxError);
      expect((err as XlsxError).code).toBe("SHEET_NOT_FOUND");
      expect((err as XlsxError).message).toContain("Available sheets");
    }
  });

  it("throws PARSE_FAILED for empty query", async () => {
    try {
      await searchXlsx(sampleXlsx, { query: "" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(XlsxError);
      expect((err as XlsxError).code).toBe("PARSE_FAILED");
    }
  });

  it("throws FILE_NOT_FOUND for nonexistent file", async () => {
    try {
      await searchXlsx("/nonexistent/path/file.xlsx", { query: "test" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(XlsxError);
      expect((err as XlsxError).code).toBe("FILE_NOT_FOUND");
    }
  });

  it("throws INVALID_XLSX for non-XLSX file", async () => {
    try {
      await searchXlsx(samplePdf, { query: "test" });
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(XlsxError);
      expect((err as XlsxError).code).toBe("INVALID_XLSX");
    }
  });

  it("defaults maxMatches to 20", async () => {
    const result = await searchXlsx(sampleXlsx, { query: "e" });
    expect(result.matches.length).toBeLessThanOrEqual(20);
  });

  it("totalSheets and sheetsSearched reflect correct counts", async () => {
    const result = await searchXlsx(sampleXlsx, { query: "e" });
    expect(result.totalSheets).toBe(3);
    expect(result.sheetsSearched).toBe(3);
  });

  it("cells contains full row data", async () => {
    const result = await searchXlsx(sampleXlsx, { query: "Revenue" });
    const cells = result.matches[0].cells;
    expect(cells.Category).toBe("Revenue");
    expect(cells.Q1).toBe("1.2M");
    expect(cells.Q2).toBe("1.5M");
    expect(cells.Q3).toBe("1.8M");
  });
});
