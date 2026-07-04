import { Type } from "typebox";

export const ReadPdfSchema = Type.Object({
  path: Type.String({ description: "Path to the PDF file" }),
  pages: Type.Optional(
    Type.String({
      description: 'Pages to extract, e.g. "1-5,10,15-20". Omit for all pages.',
    }),
  ),
  maxPages: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Max pages to parse (default: 1000)",
    }),
  ),
  password: Type.Optional(
    Type.String({ description: "Password for encrypted PDFs" }),
  ),
});

export const SearchPdfSchema = Type.Object({
  path: Type.String({ description: "Path to the PDF file" }),
  query: Type.String({
    description: "Search query. Case-insensitive substring match.",
  }),
  contextLines: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 5,
      description: "Lines of context around each match (default: 1)",
    }),
  ),
  maxMatches: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Max matches to return (default: 20)",
    }),
  ),
  password: Type.Optional(
    Type.String({ description: "Password for encrypted PDFs" }),
  ),
});

export const ReadDocxSchema = Type.Object({
  path: Type.String({ description: "Path to the .docx file" }),
  maxChars: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Max characters in preview (default: 2000)",
    }),
  ),
});

export const SearchDocxSchema = Type.Object({
  path: Type.String({ description: "Path to the .docx file" }),
  query: Type.String({
    description: "Search query. Case-insensitive substring match.",
  }),
  contextChars: Type.Optional(
    Type.Integer({
      minimum: 20,
      maximum: 500,
      description: "Characters of context around each match (default: 100)",
    }),
  ),
  maxMatches: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Max matches to return (default: 20)",
    }),
  ),
});

export const ReadXlsxSchema = Type.Object({
  path: Type.String({ description: "Path to the .xlsx file" }),
  sheet: Type.Optional(
    Type.String({
      description: "Sheet name to read. Omit to get sheet index with previews.",
    }),
  ),
  maxRows: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        "Max rows in preview per sheet (default: 10, index mode only)",
    }),
  ),
  headerRow: Type.Optional(
    Type.Integer({
      minimum: 0,
      description:
        "0-indexed row number to use as headers. Auto-detected when omitted.",
    }),
  ),
});

export const SearchXlsxSchema = Type.Object({
  path: Type.String({ description: "Path to the .xlsx file" }),
  query: Type.String({
    description: "Search query. Case-insensitive substring match.",
  }),
  sheet: Type.Optional(
    Type.String({
      description:
        "Limit search to a specific sheet. Omit to search all sheets.",
    }),
  ),
  maxMatches: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Max matches to return (default: 20)",
    }),
  ),
});
