import { loadPiConfig } from "@mammothb/pi-shared";

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
  override: Record<string, unknown>,
): ToastConfig {
  const merged = { ...base };
  if (override.path !== undefined) {
    merged.path = override.path as string | undefined;
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
  return loadPiConfig("pi-toast.json", cwd, DEFAULT_CONFIG, mergeConfigs);
}
