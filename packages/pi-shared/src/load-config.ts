import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Read and parse a JSON config file. Returns null if the file doesn't exist
 * or contains invalid JSON. On parse failure, logs an error with the given label.
 */
export function readConfigFile(
  path: string,
  label: string,
): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(
      `${label}: failed to parse config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Load a pi extension config by merging defaults → global → project.
 *
 * Global config is read from `~/.pi/agent/<packageName>`.
 * Project config is read from `<cwd>/.pi/<packageName>`.
 *
 * @param packageName  Config file name (e.g. "pi-eval.json")
 * @param cwd          Working directory (project root)
 * @param defaults     The default config object
 * @param merge        Merge function: (base, overrides) => merged config.
 *                     Must return a new object; must not mutate base.
 * @returns merged config of type T (or defaults when no files exist)
 */
export function loadPiConfig<T>(
  packageName: string,
  cwd: string,
  defaults: T,
  merge: (base: T, overrides: Record<string, unknown>) => T,
): T {
  const label = packageName.replace(/\.json$/, "");
  const globalPath = join(getAgentDir(), packageName);
  const projectPath = join(cwd, ".pi", packageName);

  const globalConfig = readConfigFile(globalPath, label);
  const projectConfig = readConfigFile(projectPath, label);

  let config = defaults;
  if (globalConfig) {
    config = merge(config, globalConfig);
  }
  if (projectConfig) {
    config = merge(config, projectConfig);
  }

  return config;
}
