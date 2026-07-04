import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { searchXlsx, type XlsxSearchMatch } from "../parsers.js";
import { SearchXlsxSchema } from "../schemas.js";
import { buildToolResponse } from "../utils.js";

export interface SearchXlsxDetails {
  stats: {
    totalSheets: number;
    sheetsSearched: number;
    totalMatches: number;
    matchesReturned: number;
    truncated: boolean;
    sheet?: string;
  };
  matches: XlsxSearchMatch[];
}

function formatMatchRow(match: XlsxSearchMatch, query: string): string {
  const entries = Object.entries(match.cells);
  const cellStr = entries
    .map(([k, v]) => {
      if (v.toLowerCase().includes(query.toLowerCase())) {
        return `${k}: "${v}"`;
      }
      return `${k}: ${v}`;
    })
    .join(", ");
  return `──${match.sheet}── row ${match.row}: ${cellStr}`;
}

function formatMatches(
  query: string,
  totalSheets: number,
  sheetsSearched: number,
  matches: XlsxSearchMatch[],
  totalMatches: number,
  truncated: boolean,
): string {
  if (totalMatches === 0) {
    return [
      `No matches found for "${query}" across ${sheetsSearched} sheet${sheetsSearched === 1 ? "" : "s"} (${totalSheets} total).`,
    ].join("\n");
  }

  const header = truncated
    ? `Found ${totalMatches} matches across ${sheetsSearched} sheet${sheetsSearched === 1 ? "" : "s"} (${totalSheets} total). Showing first ${matches.length}:`
    : `Found ${totalMatches} match${totalMatches === 1 ? "" : "es"} across ${sheetsSearched} sheet${sheetsSearched === 1 ? "" : "s"} (${totalSheets} total):`;

  const blocks = matches.map((m) => formatMatchRow(m, query));

  return [header, "", ...blocks].join("\n");
}

export function createSearchXlsxTool(): ToolDefinition<
  typeof SearchXlsxSchema,
  SearchXlsxDetails
> {
  return {
    name: "search_xlsx",
    label: "Search XLSX",
    description:
      "Search for text in an Excel .xlsx file. Case-insensitive substring matching across all cell values. Returns sheet name and row number for each match.",
    promptSnippet: "Find text in an Excel spreadsheet",
    promptGuidelines: [
      "search_xlsx: case-insensitive substring matching across all cell values.",
      "search_xlsx: returns sheet name and row number for each match.",
      "search_xlsx: use the sheet parameter to limit search to one sheet.",
    ],
    parameters: SearchXlsxSchema,

    async execute(_toolCallId, params, signal, _onUpdate) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const { path, query, sheet, maxMatches } = params;

      const result = await searchXlsx(path, { query, sheet, maxMatches });

      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      const preview = formatMatches(
        query,
        result.totalSheets,
        result.sheetsSearched,
        result.matches,
        result.totalMatches,
        result.truncated,
      );

      return buildToolResponse(preview, {
        stats: {
          totalSheets: result.totalSheets,
          sheetsSearched: result.sheetsSearched,
          totalMatches: result.totalMatches,
          matchesReturned: result.matches.length,
          truncated: result.truncated,
          sheet,
        },
        matches: result.matches,
      });
    },
  };
}
