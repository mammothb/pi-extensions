import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type SearchMatch, searchPdf } from "../parsers.js";
import { SearchPdfSchema } from "../schemas.js";
import { buildToolResponse } from "../utils.js";

export interface SearchPdfDetails {
  stats: {
    totalPages: number;
    pagesSearched: number;
    totalMatches: number;
    matchesReturned: number;
    truncated: boolean;
  };
  matches: SearchMatch[];
}

function formatMatches(
  query: string,
  totalPages: number,
  matches: SearchMatch[],
  totalMatches: number,
  truncated: boolean,
): string {
  if (totalMatches === 0) {
    return `No matches found for "${query}" in ${totalPages} page${totalPages === 1 ? "" : "s"}.`;
  }

  const header = truncated
    ? `Found ${totalMatches} matches across ${totalPages} page${totalPages === 1 ? "" : "s"}. Showing first ${matches.length}:`
    : `Found ${totalMatches} match${totalMatches === 1 ? "" : "es"} across ${totalPages} page${totalPages === 1 ? "" : "s"}:`;

  const blocks = matches.map((m) => {
    const lineRange =
      m.startLine === m.endLine
        ? `line ${m.startLine}`
        : `lines ${m.startLine}-${m.endLine}`;
    return `[page ${m.page}, ${lineRange}]\n${m.context}`;
  });

  return [header, "", ...blocks].join("\n");
}

export function createSearchPdfTool(): ToolDefinition<
  typeof SearchPdfSchema,
  SearchPdfDetails
> {
  return {
    name: "search_pdf",
    label: "Search PDF",
    description:
      "Search for text in a PDF file. Returns matches with page numbers and surrounding context lines. Case-insensitive substring matching.",
    promptSnippet: "Search for text in a PDF file",
    promptGuidelines: [
      "search_pdf: case-insensitive substring matching; returns page numbers and line ranges.",
      "search_pdf: use contextLines to get surrounding text for each match.",
      "search_pdf: for full document extraction, use read_pdf instead.",
    ],
    parameters: SearchPdfSchema,

    async execute(_toolCallId, params, signal, _onUpdate) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const { path, query, contextLines, maxMatches, password } = params;

      const result = await searchPdf(path, {
        query,
        contextLines,
        maxMatches,
        password,
      });

      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const preview = formatMatches(
        query,
        result.totalPages,
        result.matches,
        result.totalMatches,
        result.truncated,
      );

      return buildToolResponse(preview, {
        stats: {
          totalPages: result.totalPages,
          pagesSearched: result.pagesSearched,
          totalMatches: result.totalMatches,
          matchesReturned: result.matches.length,
          truncated: result.truncated,
        },
        matches: result.matches,
      });
    },
  };
}
