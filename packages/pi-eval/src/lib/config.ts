import { expandTilde, loadPiConfig } from "@mammothb/pi-shared";

export interface EvalConfig {
  /**
   * Path to a python3 binary (e.g., '.venv/bin/python3' for venvs).
   * When set, this binary is used for all Python evaluations instead of
   * searching PATH for 'python3'.
   */
  pythonPath?: string;
  /**
   * Path to a node_modules directory. When set, NODE_PATH is passed
   * to the Node.js subprocess so require() resolves from this directory.
   * Use './node_modules' for project-local packages.
   */
  nodeModulesPath?: string;
}

export const DEFAULT_CONFIG: EvalConfig = {};

/**
 * Load config from JSON files. Project config (`.pi/pi-eval.json`)
 * overrides global config (`~/.pi/agent/pi-eval.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadConfig(cwd: string): EvalConfig {
  const merged = loadPiConfig(
    "pi-eval.json",
    cwd,
    DEFAULT_CONFIG,
    (base, overrides) => ({
      ...base,
      ...overrides,
    }),
  );

  return {
    ...merged,
    pythonPath: merged.pythonPath ? expandTilde(merged.pythonPath) : undefined,
    nodeModulesPath: merged.nodeModulesPath
      ? expandTilde(merged.nodeModulesPath)
      : undefined,
  };
}
