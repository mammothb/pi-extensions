import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

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
  override: Partial<WebsearchConfig>,
): WebsearchConfig {
  const merged = { ...base };

  if (override.provider !== undefined) {
    merged.provider = override.provider;
  }
  if (override.exaMcp) {
    merged.exaMcp = { ...base.exaMcp, ...override.exaMcp };
  }
  if (override.searxng) {
    merged.searxng = { ...base.searxng, ...override.searxng };
  }
  if (override.defaults) {
    merged.defaults = { ...base.defaults, ...override.defaults };
  }
  if (override.timeoutMs !== undefined) {
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
  const globalPath = join(getAgentDir(), "pi-websearch.json");
  const projectPath = join(cwd, ".pi", "pi-websearch.json");

  let global: Partial<WebsearchConfig> | undefined;
  let project: Partial<WebsearchConfig> | undefined;

  if (existsSync(globalPath)) {
    try {
      global = JSON.parse(readFileSync(globalPath, "utf-8"));
    } catch (err) {
      console.error(`Failed to load global config from ${globalPath}: ${err}`);
    }
  }

  if (existsSync(projectPath)) {
    try {
      project = JSON.parse(readFileSync(projectPath, "utf-8"));
    } catch (err) {
      console.error(
        `Failed to load project config from ${projectPath}: ${err}`,
      );
    }
  }

  let config = DEFAULT_CONFIG;
  if (global) {
    config = mergeConfigs(config, global);
  }
  if (project) {
    config = mergeConfigs(config, project);
  }

  return config;
}
