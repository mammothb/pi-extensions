import { Value } from "typebox/value";
import type { SearchArgs, SearchProvider } from "../types";
import { McpResultPayload } from "../types";

/**
 * Try to parse a JSON object from a string, returning the first text content.
 */
function tryParsePayload(payload: string): string | undefined {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const data = Value.Parse(McpResultPayload, JSON.parse(trimmed));
    return data.result.content.find((item) => item.text)?.text;
  } catch {
    return undefined;
  }
}

/** Parse an MCP response body, handling both plain JSON and SSE streams. */
export function parseResponse(body: string): string | undefined {
  const trimmed = body.trim();

  // Try direct JSON parse first
  if (trimmed) {
    const direct = tryParsePayload(trimmed);
    if (direct) {
      return direct;
    }
  }

  // Try SSE lines: "data: {...}"
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const data = tryParsePayload(line.slice(6));
    if (data) {
      return data;
    }
  }

  return undefined;
}

/**
 * Configuration for the Exa MCP provider.
 */
export interface ExaMcpConfig {
  url: string;
  tool: string;
  timeoutMs: number;
}

function buildMcpRequest(toolName: string, args: SearchArgs) {
  const value = Object.fromEntries(
    Object.entries(args).filter(([_, v]) => v !== undefined),
  );
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call" as const,
    params: { name: toolName, arguments: value },
  };
}

/**
 * Create an Exa MCP search provider.
 *
 * Communicates with an MCP-compatible server via JSON-RPC over HTTP.
 * The MCP server handles the actual search and returns formatted text.
 */
export function createExaMcpProvider(config: ExaMcpConfig): SearchProvider {
  const { url, tool, timeoutMs } = config;

  return {
    name: "exa-mcp",

    usageNotes:
      "\n  - Supports live crawling modes when available: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling)\n  - Search types when available: 'auto' (balanced), 'fast' (quick results), 'deep' (comprehensive search)",

    async search(
      args: SearchArgs,
      signal?: AbortSignal,
    ): Promise<string | undefined> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Forward external signal
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) {
          throw new Error("Request aborted");
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(buildMcpRequest(tool, args)),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Exa MCP returned HTTP ${response.status}: ${response.statusText}`,
          );
        }

        return parseResponse(await response.text());
      } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) {
          throw new Error("Request timed out");
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    },
  };
}
