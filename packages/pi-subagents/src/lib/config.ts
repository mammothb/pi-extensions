import { loadPiConfig } from "@mammothb/pi-shared";
import type { SubagentConfig } from "./types.js";

const DEFAULTS: SubagentConfig = {
  tiers: {},
  stuckTimeoutMs: 60_000,
};

function parseTiers(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn(
      `subagents: "tiers" must be an object, got ${Array.isArray(raw) ? "array" : typeof raw} — using defaults`,
    );
    return {};
  }

  const tiers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      tiers[key] = value;
    } else {
      console.warn(
        `subagents: ignoring tier "${key}" — value must be a string, got ${typeof value}`,
      );
    }
  }
  return tiers;
}

function parseStuckTimeout(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  console.warn(
    `subagents: "stuckTimeoutMs" must be a non-negative finite number, got ${raw} — using default`,
  );
  return fallback;
}

function mergeConfig(
  base: SubagentConfig,
  override: Record<string, unknown>,
): SubagentConfig {
  const merged = { ...base };

  if (override.tiers !== undefined) {
    const parsed = parseTiers(override.tiers);
    // Merge at key level: project tiers add/override individual keys
    merged.tiers = { ...base.tiers, ...parsed };
  }
  if (override.stuckTimeoutMs !== undefined) {
    merged.stuckTimeoutMs = parseStuckTimeout(
      override.stuckTimeoutMs,
      base.stuckTimeoutMs,
    );
  }

  return merged;
}

/**
 * Load subagent configuration from JSON files.
 * Project config (`.pi/pi-subagents.json`) overrides global config
 * (`~/.pi/agent/pi-subagents.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadSubagentConfig(cwd: string): SubagentConfig {
  return loadPiConfig("pi-subagents.json", cwd, { ...DEFAULTS }, mergeConfig);
}
