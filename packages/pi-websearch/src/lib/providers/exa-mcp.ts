import { parseResponse } from "../parsers";
import type { SearchArgs, SearchProvider } from "../types";

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
