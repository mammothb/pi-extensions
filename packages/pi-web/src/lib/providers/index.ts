import type { WebsearchConfig } from "../../config";
import { resolveUnslothEngines } from "../../config";
import type { SearchProvider } from "../types";
import { createExaMcpProvider } from "./exa-mcp";
import { createSearxngProvider } from "./searxng";
import { createUnslothProvider } from "./unsloth";

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
    case "unsloth": {
      const engines = resolveUnslothEngines(config.unsloth);
      return createUnslothProvider({
        timeoutMs: config.unsloth?.timeoutMs ?? 10_000,
        overallTimeoutMs: config.timeoutMs,
        region: config.unsloth?.region ?? "us-en",
        safesearch: config.unsloth?.safesearch ?? "moderate",
        engines,
      });
    }
    default: {
      throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}
