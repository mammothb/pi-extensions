import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ToastConfig {
  /**
   * Path to the notification executable.
   * The executable must accept two positional arguments: <title> <message>.
   * When unset, notifications are skipped.
   */
  path?: string;
}

export const DEFAULT_CONFIG: ToastConfig = {
  path: undefined,
};

function mergeConfigs(
  base: ToastConfig,
  override: Partial<ToastConfig>,
): ToastConfig {
  const merged = { ...base };
  if (override.path !== undefined) {
    merged.path = override.path;
  }
  return merged;
}

/**
 * Load config from JSON files. Project config (`.pi/pi-toast.json`)
 * overrides global config (`~/.pi/agent/pi-toast.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadConfig(cwd: string): ToastConfig {
  const globalPath = join(getAgentDir(), "pi-toast.json");
  const projectPath = join(cwd, ".pi", "pi-toast.json");

  let global: Partial<ToastConfig> | undefined;
  let project: Partial<ToastConfig> | undefined;

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
