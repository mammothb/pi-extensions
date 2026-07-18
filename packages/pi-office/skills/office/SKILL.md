---
name: office
description: >-
  Use dedicated tools (read_pdf, search_pdf, read_docx, search_docx, read_xlsx, search_xlsx) for PDF, Word, and Excel files.
  Discover structure first, search before reading full documents, then read selectively.
  Pure JS — no LibreOffice, no system dependencies, no OCR setup needed.
  Works in corporate/air-gapped environments.
---

# Office Document Reading

Use the dedicated office tools for reading PDF, DOCX, and XLSX files.
Do not fall back to manual CLI commands unless the extension tools are unavailable.

## Tool routing

- Use `read_pdf` to extract text from PDF files (all pages or a page range).
- Use `search_pdf` to find a phrase and get page numbers with surrounding context.
- Use `read_docx` to extract text from Word documents as markdown.
- Use `search_docx` to find a phrase in a Word document with character-offset context.
- Use `read_xlsx` for Excel files — omit sheet name for index mode (sheet names + preview), provide sheet name for full single sheet. Set `raw: false` to get display-formatted values (dates, currencies, percentages as shown in Excel).
- Use `search_xlsx` to find a phrase across all sheets or a specific sheet.

## Recommended workflow

1. **Use what the user gives you.** If the user mentions a specific page, sheet name, or
   section, go directly to the targeted read. Skip the discovery step — it's wasted work.
   - User says "Sheet 'Test'" → call `read_xlsx` with `sheet: "Test"` immediately.
   - User says "pages 5-10" → call `read_pdf` with `pages: "5-10"` immediately.

2. **Discover structure first (when no target given).** Call read tools with minimal parameters:
   - `read_pdf` with no `pages` → returns page count + preview
   - `read_xlsx` with no `sheet` → returns sheet index + preview of every sheet
   - `read_docx` → returns markdown preview

3. **Search before reading.** If looking for specific information, use `search_*` first.
   Returns matches with location (page, sheet, row) and surrounding context.
   This avoids reading entire large documents.

4. **Read selectively.** Once you know which pages/sheets/sections matter, call `read_*`
   with specific parameters (`pages`, `sheet`) to pull only what you need.

## Choose the smallest useful scope

- For PDF: pass `pages` to extract only relevant pages, not the whole document.
- For XLSX: if the user names a sheet, read it directly. Otherwise use index mode first (no `sheet` param) to see what's available, then request specific sheets.
- For DOCX: the full markdown is usually manageable; use `search_docx` for large documents.

## Follow-up workflow

Read tools write parsed output to temporary files and return their paths.

After calling tools:
1. Inspect returned output paths with `read` when full content is needed.
2. Do not inline large documents into context — let the tool save the full result, then inspect selectively.
3. Only copy files into the project if the user wants persistent artifacts.

## Important constraints

- All tools are pure JavaScript — no LibreOffice, ImageMagick, or OCR setup required.
- Passwords are supported for encrypted PDFs via the `password` parameter.
- Tools accept standard file paths (relative, absolute, `~`-prefixed).
- Output files are temporary by default. Copy them if the user needs persistent files.

## Good default patterns

### Read a PDF

Use `read_pdf` with:
- `pages` if only part of the document matters
- `password` for encrypted PDFs

Then inspect the returned text file with `read`.

### Find specific information in a PDF

Use `search_pdf` with:
- `query` for the search term
- `contextLines` to control surrounding context (default: 1)
- `maxMatches` for broad searches (default: 20)

Use returned page numbers for targeted `read_pdf` follow-up.

### Explore a multi-sheet Excel workbook

Use `read_xlsx` without `sheet` to see sheet names and previews.
Then call `read_xlsx` with `sheet` to pull the full data.

### Search across Excel sheets

Use `search_xlsx` with:
- `query` for the search term
- `sheet` to limit to one sheet (optional)

Returns sheet name and row for each match.

### Read a Word document

Use `read_docx` to get markdown output. Parse with mammoth —
headings, lists, and tables are preserved in markdown format.
