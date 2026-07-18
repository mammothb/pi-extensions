import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import TurndownService from "turndown";
import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";
import { resolvePath } from "./utils.js";

const turndown = new TurndownService();

export interface ParsePdfOptions {
  /** Pages to extract, e.g. "1-5,10,15-20". Omit for all pages. */
  pages?: string;
  /** Max pages to parse. Default: unlimited. */
  maxPages?: number;
  /** Password for encrypted PDFs. */
  password?: string;
}

export interface ParsePdfResult {
  totalPages: number;
  text: string;
}

export interface ParseDocxResult {
  markdown: string;
  warnings: string[];
}

export interface SearchDocxOptions {
  /** Search query. Case-insensitive substring match. */
  query: string;
  /** Characters of context around each match. Default: 100. */
  contextChars?: number;
  /** Max matches to return. Default: 20. */
  maxMatches?: number;
}

export interface DocxSearchMatch {
  /** 0-indexed character offset where the match starts. */
  charOffset: number;
  /** Context text surrounding the match. */
  context: string;
}

export interface SearchDocxResult {
  /** Total characters in the parsed markdown. */
  totalChars: number;
  /** Matches found (up to maxMatches). */
  matches: DocxSearchMatch[];
  /** Total matches found before maxMatches truncation. */
  totalMatches: number;
  /** True if matches were truncated by maxMatches. */
  truncated: boolean;
}

export interface SearchPdfOptions {
  /** Search query. Case-insensitive substring match. */
  query: string;
  /** Lines of context around each match. Default: 1. */
  contextLines?: number;
  /** Max matches to return. Default: 20. */
  maxMatches?: number;
  /** Password for encrypted PDFs. */
  password?: string;
}

export interface SearchMatch {
  /** 1-indexed page number. */
  page: number;
  /** 1-indexed, first line of the context block. */
  startLine: number;
  /** 1-indexed, last line of the context block. */
  endLine: number;
  /** 1-indexed, the line containing the match. */
  matchLine: number;
  /** All context lines joined with \n. */
  context: string;
}

export interface SearchPdfResult {
  /** Total pages in the PDF. */
  totalPages: number;
  /** Number of pages searched. */
  pagesSearched: number;
  /** Matches found (up to maxMatches). */
  matches: SearchMatch[];
  /** Total matches found before maxMatches truncation. */
  totalMatches: number;
  /** True if matches were truncated by maxMatches. */
  truncated: boolean;
}

/**
 * Parse a comma-separated page range string into a sorted array of page numbers (1-indexed).
 * Ranges can be: "1-5" (inclusive), "10" (single page), "1-5,10,15-20".
 * Returns all pages if the string is empty or undefined.
 */
export function parsePageRanges(
  spec: string | undefined,
  totalPages: number,
): number[] {
  if (!spec || spec.trim() === "") {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      const start = Math.max(1, Number(startStr));
      const end = Math.min(totalPages, Number(endStr));
      for (let i = start; i <= end; i++) {
        pages.add(i);
      }
    } else {
      const pageNum = Number(trimmed);
      if (pageNum >= 1 && pageNum <= totalPages) {
        pages.add(pageNum);
      }
    }
  }

  return [...pages].sort((a, b) => a - b);
}

/**
 * Categorized errors for LLM-consumable messages.
 */
export class PdfError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "FILE_NOT_FOUND"
      | "ENCRYPTED"
      | "INVALID_PASSWORD"
      | "INVALID_PDF"
      | "PARSE_FAILED",
  ) {
    super(message);
    this.name = "PdfError";
  }
}

/**
 * Categorized errors for DOCX parsing.
 */
export class DocxError extends Error {
  constructor(
    message: string,
    public readonly code: "FILE_NOT_FOUND" | "INVALID_DOCX" | "PARSE_FAILED",
  ) {
    super(message);
    this.name = "DocxError";
  }
}

/**
 * Categorized errors for XLSX parsing.
 */
export class XlsxError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "FILE_NOT_FOUND"
      | "INVALID_XLSX"
      | "SHEET_NOT_FOUND"
      | "PARSE_FAILED",
  ) {
    super(message);
    this.name = "XlsxError";
  }
}

export interface XlsxSheetData {
  /** Sheet name. */
  name: string;
  /** Total data rows (excluding header). */
  rows: number;
  /** Number of columns. */
  cols: number;
  /** Column headers. */
  headers: string[];
  /** Data rows as objects keyed by header. */
  data: Record<string, string>[];
  /** 0-indexed row number that was used as headers. */
  headerRow: number;
}

export interface ParseXlsxResult {
  /** All sheet names in the workbook. */
  sheetNames: string[];
  /** Index mode: preview of every sheet. */
  sheets: XlsxSheetData[];
  /** Sheet mode: full data for requested sheet. Present only when `sheet` option is given. */
  sheet?: XlsxSheetData;
}

export interface ParseXlsxOptions {
  /** Sheet name to read. Omit for index mode. */
  sheet?: string;
  /** Max rows in preview per sheet (index mode only). Default: 10. */
  maxRows?: number;
  /** 0-indexed row number to use as headers. Auto-detected when omitted. */
  headerRow?: number;
  /** Return raw values (true, default) or display-formatted strings (false). */
  raw?: boolean;
}

export interface SearchXlsxOptions {
  /** Search query. Case-insensitive substring match. */
  query: string;
  /** Limit search to a specific sheet. Omit to search all sheets. */
  sheet?: string;
  /** Max matches to return. Default: 20. */
  maxMatches?: number;
}

export interface XlsxSearchMatch {
  /** Sheet name containing the match. */
  sheet: string;
  /** 1-indexed row number in the sheet. */
  row: number;
  /** The matched row's column values. */
  cells: Record<string, string>;
}

export interface SearchXlsxResult {
  /** Total sheets in the workbook. */
  totalSheets: number;
  /** Number of sheets searched. */
  sheetsSearched: number;
  /** Matches found (up to maxMatches). */
  matches: XlsxSearchMatch[];
  /** Total matches found before maxMatches truncation. */
  totalMatches: number;
  /** True if matches were truncated by maxMatches. */
  truncated: boolean;
}

/**
 * Fill merged cell values into all cells of the range in a raw 2D array.
 * Only the top-left cell of a merged range has a value from sheet_to_json;
 * this copies it to all other cells so header detection and data extraction work.
 */
function unmergeRaw(raw: unknown[][], merges: XLSX.Range[]): void {
  for (const merge of merges) {
    const { s, e } = merge;
    const topVal = raw[s.r]?.[s.c];
    // Skip if the top-left cell is empty or missing (nothing to spread)
    if (
      topVal === undefined ||
      topVal === null ||
      String(topVal).trim() === ""
    ) {
      continue;
    }
    for (let r = s.r; r <= e.r; r++) {
      const row = raw[r];
      if (!row) {
        continue;
      }
      for (let c = s.c; c <= e.c; c++) {
        // Don't overwrite the top-left cell itself (already has the value)
        if (r === s.r && c === s.c) {
          continue;
        }
        row[c] = topVal;
      }
    }
  }
}

/** Header label pattern: starts with a letter, short text (< 50 chars). */
const HEADER_LIKE = /^[A-Za-z][\w\s/\-&()]{0,49}$/;
/** Data-like pattern: purely numeric, ordinal dates (1st, 2nd), time values, or formulas. */
const DATA_LIKE = /^(\d{1,2}(st|nd|rd|th)|\d+(\.\d+)?|[=+\-*/].*)$/;

function isHeaderLike(v: string): boolean {
  const t = v.trim();
  return t.length > 0 && HEADER_LIKE.test(t) && !DATA_LIKE.test(t);
}

function isDataLike(v: string): boolean {
  const t = v.trim();
  return t.length > 0 && DATA_LIKE.test(t);
}

/**
 * Score each row as a potential header and return the 0-indexed row number
 * of the best candidate. A good header row has many non-empty cells with
 * high uniqueness and header-like labels (text, not numeric data).
 */
function findHeaderRow(raw: unknown[][]): number {
  let bestRow = 0;
  let bestScore = -1;

  for (let r = 0; r < raw.length; r++) {
    const row = raw[r];
    if (!row) {
      continue;
    }
    const values = (row as unknown[])
      .map((c) => String(c ?? "").trim())
      .filter((v) => v !== "");
    if (values.length === 0) {
      continue;
    }

    const unique = new Set(values);
    const uniquenessRatio = unique.size / values.length;

    let headerBonus = 0;
    let dataPenalty = 0;
    for (const v of values) {
      if (isHeaderLike(v)) {
        headerBonus++;
      } else if (isDataLike(v)) {
        dataPenalty++;
      }
    }

    // Core score: uniqueness rewards distinct column labels,
    // punishes merged labels spread across columns.
    // Bonus for header-like text, penalty for data-like numbers.
    const score =
      values.length * uniquenessRatio + headerBonus * 0.5 - dataPenalty * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }

  return bestRow;
}

/** Column letters A-Z, AA-ZZ, etc. for disambiguation. */
function colLetter(index: number): string {
  let n = index;
  let result = "";
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * Disambiguate duplicate header names by appending column letters.
 * Empty-string headers become the column letter itself.
 */
function disambiguateHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const key = h || colLetter(i);
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) {
      return key;
    }
    // Duplicate: append column letter to differentiate
    return `${key}_${colLetter(i)}`;
  });
}

/**
 * Read and parse an XLSX file.
 *
 * Two modes:
 * - Index mode (no `sheet` option): returns preview of every sheet, truncated to `maxRows`.
 * - Sheet mode (`sheet` option given): returns full data for the named sheet.
 *
 * Merged cells are unmerged before parsing so all cells in a merged range
 * carry the top-left cell's value. If `headerRow` is not specified, the best
 * header row is auto-detected by scoring rows on non-empty cell count and
 * uniqueness.
 */
export async function parseXlsx(
  filePath: string,
  options?: ParseXlsxOptions,
): Promise<ParseXlsxResult> {
  const resolved = resolvePath(filePath);

  // Read file
  let buffer: ArrayBuffer;
  try {
    const buf = await readFile(resolved);
    buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new XlsxError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }
    throw new XlsxError(
      `Failed to read file: ${(err as Error).message ?? err}`,
      "PARSE_FAILED",
    );
  }

  // Validate ZIP magic bytes (XLSX files are ZIP archives)
  const header = new Uint8Array(buffer, 0, 4);
  const isZip =
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04;
  if (!isZip) {
    throw new XlsxError("Not a valid XLSX file.", "INVALID_XLSX");
  }

  // Parse workbook
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Unsupported") ||
      msg.includes("not a valid") ||
      msg.includes("zip")
    ) {
      throw new XlsxError("Not a valid XLSX file.", "INVALID_XLSX");
    }
    throw new XlsxError(`Failed to parse XLSX: ${msg}`, "PARSE_FAILED");
  }

  const sheetNames = workbook.SheetNames;
  const maxRows = options?.maxRows ?? 10;

  // Build data for each sheet
  const sheets: XlsxSheetData[] = [];
  let foundSheet: XlsxSheetData | undefined;

  for (const name of sheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) {
      continue;
    }

    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      raw: options?.raw ?? true,
    });

    // Unmerge cells: fill top-left values into all cells of merged ranges
    const merges = ws["!merges"];
    if (merges && merges.length > 0) {
      unmergeRaw(raw, merges);
    }

    // Determine header row
    const headerRow =
      options?.headerRow !== undefined ? options.headerRow : findHeaderRow(raw);

    const rawHeaders =
      raw.length > headerRow
        ? (raw[headerRow] as unknown[]).map((c) => String(c ?? ""))
        : [];
    const headers = disambiguateHeaders(rawHeaders);
    const cols = headers.length;

    // Data rows are everything after the header row
    const bodyRows = raw.slice(headerRow + 1);

    // Convert rows to array-of-objects
    const toObjects = (rows: unknown[][]): Record<string, string>[] =>
      rows.map((row) => {
        const obj: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i] ?? ""] = String(row[i] ?? "");
        }
        return obj;
      });

    const allData = toObjects(bodyRows);
    let data: Record<string, string>[];

    if (options?.sheet) {
      // Sheet mode: only return data if this is the requested sheet
      if (name === options.sheet) {
        data = allData;
        foundSheet = {
          name,
          rows: allData.length,
          cols,
          headers,
          data,
          headerRow,
        };
      }
      continue;
    }

    // Index mode: truncate to maxRows
    data = allData.slice(0, maxRows);

    sheets.push({
      name,
      rows: bodyRows.length,
      cols,
      headers,
      data,
      headerRow,
    });
  }

  if (options?.sheet && !foundSheet) {
    throw new XlsxError(
      `Sheet "${options.sheet}" not found. Available sheets: ${sheetNames.join(", ")}`,
      "SHEET_NOT_FOUND",
    );
  }

  return {
    sheetNames,
    sheets,
    sheet: foundSheet,
  };
}

/**
 * Search for text in an XLSX file.
 * Performs case-insensitive substring matching across all cell values in every row.
 * Returns matches with sheet name, row number, and row data.
 */
export async function searchXlsx(
  filePath: string,
  options: SearchXlsxOptions,
): Promise<SearchXlsxResult> {
  if (!options.query || options.query.trim() === "") {
    throw new XlsxError("Search query is required.", "PARSE_FAILED");
  }

  const maxMatches = options.maxMatches ?? 20;
  const query = options.query.toLowerCase();

  // Get sheet names (index mode — cheap, only parses headers)
  const { sheetNames } = await parseXlsx(filePath, { maxRows: 1 });

  // Validate requested sheet if given
  if (options.sheet && !sheetNames.includes(options.sheet)) {
    throw new XlsxError(
      `Sheet "${options.sheet}" not found. Available sheets: ${sheetNames.join(", ")}`,
      "SHEET_NOT_FOUND",
    );
  }

  const sheetsToSearch = options.sheet ? [options.sheet] : sheetNames;

  const matches: XlsxSearchMatch[] = [];
  let totalMatches = 0;

  for (const sheetName of sheetsToSearch) {
    // Sheet mode: get full data for this sheet
    const { sheet } = await parseXlsx(filePath, { sheet: sheetName });
    if (!sheet) {
      continue;
    }

    for (let rowIdx = 0; rowIdx < sheet.data.length; rowIdx++) {
      const row = sheet.data[rowIdx];
      if (!row) {
        continue;
      }

      const hasMatch = Object.values(row).some((val) =>
        val.toLowerCase().includes(query),
      );

      if (hasMatch) {
        totalMatches++;

        if (matches.length < maxMatches) {
          matches.push({
            sheet: sheetName,
            row: sheet.headerRow + rowIdx + 2, // 1-indexed; headerRow is 0-indexed, +1 for header row itself, +1 for first data row
            cells: row,
          });
        }
      }
    }
  }

  return {
    totalSheets: sheetNames.length,
    sheetsSearched: sheetsToSearch.length,
    matches,
    totalMatches,
    truncated: totalMatches > maxMatches,
  };
}

/**
 * Shared helper: resolve path → read file → load PDF → extract per-page text.
 * Handles all error categorization (FILE_NOT_FOUND, ENCRYPTED, INVALID_PASSWORD, INVALID_PDF).
 */
async function loadPdfPages(
  filePath: string,
  password?: string,
): Promise<{ totalPages: number; pageTexts: string[] }> {
  const resolved = resolvePath(filePath);

  // Read file
  let buffer: Buffer;
  try {
    buffer = await readFile(resolved);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new PdfError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }
    throw new PdfError(
      `Failed to read file: ${(err as Error).message ?? err}`,
      "PARSE_FAILED",
    );
  }

  // Load PDF
  const pdfOptions: Record<string, unknown> = {};
  if (password) {
    pdfOptions.password = password;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer), pdfOptions);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("password") || msg.includes("Password")) {
      if (password) {
        throw new PdfError("Incorrect password.", "INVALID_PASSWORD");
      }
      throw new PdfError("PDF is encrypted. Provide a password.", "ENCRYPTED");
    }
    if (msg.includes("Invalid") || msg.includes("not a valid")) {
      throw new PdfError("Not a valid PDF file.", "INVALID_PDF");
    }
    throw new PdfError(`Failed to parse PDF: ${msg}`, "PARSE_FAILED");
  }

  // Extract text per page
  try {
    const result = await extractText(pdf, { mergePages: false });
    return { totalPages: result.totalPages, pageTexts: result.text };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PdfError(`Failed to extract text: ${msg}`, "PARSE_FAILED");
  }
}

/**
 * Extract text from a PDF file.
 * Supports page ranges, max pages limit, and encrypted PDFs with password.
 */
export async function parsePdf(
  filePath: string,
  options?: ParsePdfOptions,
): Promise<ParsePdfResult> {
  const { totalPages: actualTotalPages, pageTexts } = await loadPdfPages(
    filePath,
    options?.password,
  );

  // Filter by page ranges
  const selectedPages = parsePageRanges(options?.pages, actualTotalPages);

  // Apply maxPages limit
  const maxPages = options?.maxPages ?? selectedPages.length;
  const limitedPages = selectedPages.slice(0, maxPages);

  // Build output with page markers
  const outputParts: string[] = [];
  for (const pageNum of limitedPages) {
    const pageIndex = pageNum - 1;
    const pageText = pageTexts[pageIndex]?.trim() ?? "";
    if (pageText) {
      outputParts.push(`--- Page ${pageNum} ---\n\n${pageText}`);
    }
  }

  const text = outputParts.join("\n\n");

  return {
    totalPages: limitedPages.length,
    text,
  };
}

/**
 * Search for text in a PDF file.
 * Returns matches with page number, line number, and context lines.
 * Case-insensitive substring matching.
 */
export async function searchPdf(
  filePath: string,
  options: SearchPdfOptions,
): Promise<SearchPdfResult> {
  if (!options.query || options.query.trim() === "") {
    throw new PdfError("Search query is required.", "PARSE_FAILED");
  }

  const contextLines = options.contextLines ?? 1;
  const maxMatches = options.maxMatches ?? 20;
  const query = options.query.toLowerCase();

  const { totalPages, pageTexts } = await loadPdfPages(
    filePath,
    options.password,
  );

  const matches: SearchMatch[] = [];
  let totalMatches = 0;

  for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
    const pageText = pageTexts[pageIdx]?.trim() ?? "";
    if (!pageText) {
      continue;
    }

    const lines = pageText.split("\n");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const lowerLine = line.toLowerCase();

      // Find all occurrences on this line
      let searchFrom = 0;
      while (true) {
        searchFrom = lowerLine.indexOf(query, searchFrom);
        if (searchFrom === -1) {
          break;
        }

        totalMatches++;

        if (matches.length < maxMatches) {
          const lineStart = Math.max(0, lineIdx - contextLines);
          const lineEnd = Math.min(lines.length - 1, lineIdx + contextLines);
          const context = lines.slice(lineStart, lineEnd + 1).join("\n");

          matches.push({
            page: pageIdx + 1,
            startLine: lineStart + 1,
            endLine: lineEnd + 1,
            matchLine: lineIdx + 1,
            context,
          });
        }

        searchFrom += query.length;
      }
    }
  }

  return {
    totalPages,
    pagesSearched: pageTexts.length,
    matches,
    totalMatches,
    truncated: totalMatches > maxMatches,
  };
}

/**
 * Convert a DOCX file to markdown.
 * Uses mammoth for DOCX → HTML and turndown for HTML → markdown.
 */
export async function parseDocx(filePath: string): Promise<ParseDocxResult> {
  const resolved = resolvePath(filePath);

  // Read file
  let buffer: Buffer;
  try {
    buffer = await readFile(resolved);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new DocxError(`File not found: ${filePath}`, "FILE_NOT_FOUND");
    }
    throw new DocxError(
      `Failed to read file: ${(err as Error).message ?? err}`,
      "PARSE_FAILED",
    );
  }

  // Convert DOCX → HTML
  let html: string;
  let warnings: string[];
  try {
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
    warnings = result.messages.map((m) => m.message);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Can't find end of central directory") ||
      msg.includes("Could not find") ||
      msg.includes("not a valid") ||
      msg.includes("Unsupported") ||
      msg.includes("is this a zip file")
    ) {
      throw new DocxError("Not a valid DOCX file.", "INVALID_DOCX");
    }
    throw new DocxError(`Failed to parse DOCX: ${msg}`, "PARSE_FAILED");
  }

  // Convert HTML → markdown
  const markdown = turndown.turndown(html);

  return { markdown, warnings };
}

/**
 * Search for text in a DOCX file.
 * Parses the DOCX to markdown, then performs a case-insensitive substring search
 * with character-offset context.
 */
export async function searchDocx(
  filePath: string,
  options: SearchDocxOptions,
): Promise<SearchDocxResult> {
  if (!options.query || options.query.trim() === "") {
    throw new DocxError("Search query is required.", "PARSE_FAILED");
  }

  const contextChars = options.contextChars ?? 100;
  const maxMatches = options.maxMatches ?? 20;
  const query = options.query.toLowerCase();

  const { markdown } = await parseDocx(filePath);

  const matches: DocxSearchMatch[] = [];
  let totalMatches = 0;

  const lowerMarkdown = markdown.toLowerCase();
  let searchFrom = 0;

  while (true) {
    searchFrom = lowerMarkdown.indexOf(query, searchFrom);
    if (searchFrom === -1) {
      break;
    }

    totalMatches++;

    if (matches.length < maxMatches) {
      const halfContext = Math.floor(contextChars / 2);
      const contextStart = Math.max(0, searchFrom - halfContext);
      const contextEnd = Math.min(
        markdown.length,
        searchFrom + query.length + halfContext,
      );
      const context = markdown.slice(contextStart, contextEnd);

      matches.push({
        charOffset: searchFrom,
        context,
      });
    }

    searchFrom += query.length;
  }

  return {
    totalChars: markdown.length,
    matches,
    totalMatches,
    truncated: totalMatches > maxMatches,
  };
}
