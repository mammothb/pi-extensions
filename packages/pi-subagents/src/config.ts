import { loadPiConfig } from "@mammothb/pi-shared";

export interface SubagentsConfig {
  /** Jump into the newly spawned research pane after /rsh. */
  focusOnStart: boolean;
}

export const DEFAULT_CONFIG: SubagentsConfig = {
  focusOnStart: true,
};

/**
 * Merge a config override into the base. Only known fields with the right
 * types are applied; everything else is ignored.
 */
function mergeConfig(
  base: SubagentsConfig,
  override: Record<string, unknown>,
): SubagentsConfig {
  const merged = { ...base };
  if (typeof override.focusOnStart === "boolean") {
    merged.focusOnStart = override.focusOnStart;
  }
  return merged;
}

/**
 * Load config from JSON files. Project config (`.pi/pi-subagents.json`)
 * overrides global config (`~/.pi/agent/pi-subagents.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadConfig(cwd: string): SubagentsConfig {
  return loadPiConfig("pi-subagents.json", cwd, DEFAULT_CONFIG, mergeConfig);
}
