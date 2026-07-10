import type { WebsearchConfig } from "../../config";
import type { SearchProvider } from "../types";
import { createExaMcpProvider } from "./exa-mcp";
import { createSearxngProvider } from "./searxng";

/**
 * Create a search provider based on the current configuration.
 */
export function createProvider(config: WebsearchConfig): SearchProvider {
  switch (config.provider) {
    case "exa-mcp": {
      return createExaMcpProvider({
        url: config.exaMcp.url,
        tool: config.exaMcp.tool,
        timeoutMs: config.timeoutMs,
      });
    }
    case "searxng": {
      return createSearxngProvider({
        url: config.searxng.url,
        safesearch: config.searxng.safesearch,
        timeoutMs: config.timeoutMs,
      });
    }
    default: {
      throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}
