import { loadPiConfig } from "@mammothb/pi-shared";

export const ALL_UNSLOTH_ENGINES = [
  "duckduckgo",
  "brave",
  "google",
  "mojeek",
  "yahoo",
  "yandex",
  "wikipedia",
] as const;

export type UnslothEngineId = (typeof ALL_UNSLOTH_ENGINES)[number];

function assertEngineArray(
  value: unknown,
  label: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Unsloth: ${label} must be an array`);
  }
}

function validateEngineIds(ids: unknown[]): void {
  for (const id of ids) {
    if (
      typeof id !== "string" ||
      !(ALL_UNSLOTH_ENGINES as readonly string[]).includes(id)
    ) {
      throw new Error(
        `Unknown unsloth engine: "${String(id)}". Valid: ${ALL_UNSLOTH_ENGINES.join(", ")}`,
      );
    }
  }
}

function dedupeEngines(ids: UnslothEngineId[]): UnslothEngineId[] {
  const deduped: UnslothEngineId[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      deduped.push(id);
    }
  }
  return deduped;
}

function resolveAllowlist(engines: unknown[]): UnslothEngineId[] {
  assertEngineArray(engines, "engines");
  validateEngineIds(engines);
  const deduped = dedupeEngines(engines as UnslothEngineId[]);
  if (deduped.length === 0) {
    throw new Error("Unsloth: no engines enabled");
  }
  return deduped;
}

function resolveBlocklist(disabled: unknown[]): UnslothEngineId[] {
  assertEngineArray(disabled, "disabledEngines");
  validateEngineIds(disabled);
  const disabledSet = new Set(disabled as string[]);
  const filtered = (ALL_UNSLOTH_ENGINES as readonly string[]).filter(
    (e) => !disabledSet.has(e),
  ) as UnslothEngineId[];
  if (filtered.length === 0) {
    throw new Error("Unsloth: no engines enabled");
  }
  return filtered;
}

const UNSLOTH_REGION_RE = /^[a-z]{2}-[a-z]{2}$/;

export function resolveUnslothEngines(
  cfg?: {
    engines?: UnslothEngineId[];
    disabledEngines?: UnslothEngineId[];
  } | null,
): UnslothEngineId[] {
  if (!cfg) {
    return [...ALL_UNSLOTH_ENGINES];
  }
  const hasEngines = cfg.engines !== undefined;
  const hasDisabled = cfg.disabledEngines !== undefined;
  if (hasEngines && hasDisabled) {
    throw new Error(
      "Unsloth: engines and disabledEngines are mutually exclusive",
    );
  }
  if (hasEngines) {
    return resolveAllowlist(cfg.engines as unknown[]);
  }
  if (hasDisabled) {
    return resolveBlocklist(cfg.disabledEngines as unknown[]);
  }
  return [...ALL_UNSLOTH_ENGINES];
}

export interface WebsearchConfig {
  /** Which provider to use. */
  provider: "exa-mcp" | "searxng" | "unsloth";
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
  /** Unsloth provider configuration (direct multi-engine scraper). */
  unsloth?: {
    /** Per-engine fetch timeout in ms (default 10_000). */
    timeoutMs?: number;
    /** Region string, e.g. "us-en" (default "us-en"). */
    region?: string;
    /** SafeSearch level (default "moderate"). */
    safesearch?: "on" | "moderate" | "off";
    /** Allowlist — when set, only these engines run. Mutually exclusive with disabledEngines. */
    engines?: UnslothEngineId[];
    /** Blocklist — these engines are removed. Mutually exclusive with engines. */
    disabledEngines?: UnslothEngineId[];
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
  unsloth: undefined,
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
function isValidProvider(value: string): value is WebsearchConfig["provider"] {
  return value === "exa-mcp" || value === "searxng" || value === "unsloth";
}

function validateUnslothRegion(region: unknown): void {
  if (
    typeof region !== "string" ||
    !UNSLOTH_REGION_RE.test(region.toLowerCase())
  ) {
    throw new Error(
      `Unsloth: region must match xx-yy (e.g. us-en), got "${String(region)}"`,
    );
  }
}

function validateUnslothSafeSearch(value: unknown): void {
  if (value !== "on" && value !== "moderate" && value !== "off") {
    throw new Error(
      `Unsloth: safesearch must be "on", "moderate", or "off", got "${String(value)}"`,
    );
  }
}

function mergeUnsloth(
  base: WebsearchConfig["unsloth"],
  overrideUnsloth: Record<string, unknown>,
): WebsearchConfig["unsloth"] {
  const mergedUnsloth: Record<string, unknown> = {
    ...(base ?? {}),
    ...overrideUnsloth,
  };
  if ("region" in overrideUnsloth) {
    validateUnslothRegion(overrideUnsloth["region"]);
  }
  if ("safesearch" in overrideUnsloth) {
    validateUnslothSafeSearch(overrideUnsloth["safesearch"]);
  }
  const hasEngines = overrideUnsloth["engines"] !== undefined;
  const hasDisabled = overrideUnsloth["disabledEngines"] !== undefined;
  if (hasEngines && !hasDisabled) {
    delete mergedUnsloth["disabledEngines"];
  }
  if (hasDisabled && !hasEngines) {
    delete mergedUnsloth["engines"];
  }
  return mergedUnsloth as WebsearchConfig["unsloth"];
}

function mergeConfig(
  base: WebsearchConfig,
  override: Record<string, unknown>,
): WebsearchConfig {
  const merged = { ...base };

  if (
    typeof override.provider === "string" &&
    isValidProvider(override.provider)
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
  if (override.unsloth && typeof override.unsloth === "object") {
    merged.unsloth = mergeUnsloth(
      base.unsloth,
      override.unsloth as Record<string, unknown>,
    ); // needed: narrows unknown to indexable record
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
 * Load config from JSON files. Project config (`.pi/pi-web.json`)
 * overrides global config (`~/.pi/agent/pi-web.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadConfig(cwd: string): WebsearchConfig {
  return loadPiConfig("pi-web.json", cwd, DEFAULT_CONFIG, mergeConfig);
}
