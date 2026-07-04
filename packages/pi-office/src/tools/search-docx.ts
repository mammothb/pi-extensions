import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type DocxSearchMatch, searchDocx } from "../parsers.js";
import { SearchDocxSchema } from "../schemas.js";
import { buildToolResponse } from "../utils.js";

export interface SearchDocxDetails {
  stats: {
    totalChars: number;
    totalMatches: number;
    matchesReturned: number;
    truncated: boolean;
  };
  matches: DocxSearchMatch[];
}

function formatMatches(
  query: string,
  totalChars: number,
  matches: DocxSearchMatch[],
  totalMatches: number,
  truncated: boolean,
): string {
  if (totalMatches === 0) {
    return `No matches found for "${query}" (${totalChars} characters searched).`;
  }

  const header = truncated
    ? `Found ${totalMatches} matches. Showing first ${matches.length}:`
    : `Found ${totalMatches} match${totalMatches === 1 ? "" : "es"}:`;

  const blocks = matches.map(
    (m, i) => `[match ${i + 1}, offset ${m.charOffset}]\n${m.context}`,
  );

  return [header, "", ...blocks].join("\n");
}

export function createSearchDocxTool(): ToolDefinition<
  typeof SearchDocxSchema,
  SearchDocxDetails
> {
  return {
    name: "search_docx",
    label: "Search DOCX",
    description:
      "Search for text in a .docx file. Returns matches with surrounding character context. Case-insensitive substring matching.",
    promptSnippet: "Search for text in a Word document",
    promptGuidelines: [
      "search_docx: case-insensitive substring matching with surrounding character context.",
      "search_docx: for full document extraction, use read_docx instead.",
    ],
    parameters: SearchDocxSchema,

    async execute(_toolCallId, params, signal, _onUpdate) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const { path, query, contextChars, maxMatches } = params;

      const result = await searchDocx(path, {
        query,
        contextChars,
        maxMatches,
      });

      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const preview = formatMatches(
        query,
        result.totalChars,
        result.matches,
        result.totalMatches,
        result.truncated,
      );

      return buildToolResponse(preview, {
        stats: {
          totalChars: result.totalChars,
          totalMatches: result.totalMatches,
          matchesReturned: result.matches.length,
          truncated: result.truncated,
        },
        matches: result.matches,
      });
    },
  };
}
