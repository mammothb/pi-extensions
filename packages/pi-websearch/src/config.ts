import { loadPiConfig } from "@mammothb/pi-shared";

export interface WebsearchConfig {
  /** Which provider to use. */
  provider: "exa-mcp" | "searxng";
  /** Exa MCP provider configuration. */
  exaMcp: {
    /** MCP server URL */
    url: string;
    /** MCP tool name */
    tool: string;
  };
  /** SearXNG provider configuration. */
  searxng: {
    /** SearXNG instance URL */
    url: string;
    /** SafeSearch level: 0 (off), 1 (moderate), 2 (strict) */
    safesearch: 0 | 1 | 2;
    /**
     * Optional path to a custom management script.
     * Must accept "up" and "down" commands (same interface as the default script).
     * When set, this script is used instead of the built-in `bin/searxng` script.
     */
    script?: string;
  };
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Default values for search parameters */
  defaults: {
    numResults: number;
    type: "auto" | "fast" | "deep";
    livecrawl: "fallback" | "preferred";
    contextMaxCharacters: number;
  };
}

export const DEFAULT_CONFIG: WebsearchConfig = {
  provider: "exa-mcp",
  exaMcp: {
    url: "https://mcp.exa.ai/mcp",
    tool: "web_search_exa",
  },
  searxng: {
    url: "http://localhost:8080",
    safesearch: 0,
    script: undefined,
  },
  timeoutMs: 25_000,
  defaults: {
    numResults: 8,
    type: "auto",
    livecrawl: "fallback",
    contextMaxCharacters: 10_000,
  },
};

/**
 * Deep-merge two configs. Arrays and primitives from `override` replace those
 * in `base`. Objects are merged recursively.
 */
function mergeConfigs(
  base: WebsearchConfig,
  override: Record<string, unknown>,
): WebsearchConfig {
  const merged = { ...base };

  if (
    typeof override.provider === "string" &&
    (override.provider === "exa-mcp" || override.provider === "searxng")
  ) {
    merged.provider = override.provider;
  }
  if (override.exaMcp && typeof override.exaMcp === "object") {
    merged.exaMcp = {
      ...base.exaMcp,
      ...(override.exaMcp as Record<string, unknown>),
    };
  }
  if (override.searxng && typeof override.searxng === "object") {
    merged.searxng = {
      ...base.searxng,
      ...(override.searxng as Record<string, unknown>),
    };
  }
  if (override.defaults && typeof override.defaults === "object") {
    merged.defaults = {
      ...base.defaults,
      ...(override.defaults as Record<string, unknown>),
    };
  }
  if (typeof override.timeoutMs === "number") {
    merged.timeoutMs = override.timeoutMs;
  }

  return merged;
}

/**
 * Load config from JSON files. Project config (`.pi/pi-websearch.json`)
 * overrides global config (`~/.pi/agent/pi-websearch.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadConfig(cwd: string): WebsearchConfig {
  return loadPiConfig("pi-websearch.json", cwd, DEFAULT_CONFIG, mergeConfigs);
}
