import { StringEnum } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import Type from "typebox";

/**
 * A search provider implementation.
 *
 * Each provider encapsulates the logic for calling a specific search backend
 * (MCP server, REST API, etc.) and returns the search results as a text string.
 */
export interface SearchProvider {
  /** Human-readable provider name (e.g. "exa-mcp", "brave", "tavily"). */
  readonly name: string;

  /**
   * Execute a search and return the result text.
   * Returns undefined if the search returned no results.
   */
  search(args: SearchArgs, signal?: AbortSignal): Promise<string | undefined>;
}

export const WebsearchParameters = Type.Object({
  query: Type.String({ description: "Web search query" }),
  numResults: Type.Optional(
    Type.Number({
      description: "Number of search results to return (default: 8)",
    }),
  ),
  livecrawl: Type.Optional(
    StringEnum(["fallback", "preferred"] as const, {
      description:
        "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    }),
  ),
  type: Type.Optional(
    StringEnum(["auto", "fast", "deep"] as const, {
      description:
        "Search type - 'auto': balanced search, 'fast': quick results, 'deep': comprehensive search (default: 'auto')",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Number({
      description:
        "Maximum characters for context string optimized for LLMs (default: 10000)",
    }),
  ),
});

export type SearchArgs = Static<typeof WebsearchParameters>;

export const McpResultPayload = Type.Object({
  result: Type.Object({
    content: Type.Array(
      Type.Object({
        type: Type.String(),
        text: Type.String(),
      }),
    ),
  }),
});
