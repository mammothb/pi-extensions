import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

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
  const globalPath = join(getAgentDir(), "pi-eval.json");
  const projectPath = join(cwd, ".pi", "pi-eval.json");

  let global: Partial<EvalConfig> | undefined;
  let project: Partial<EvalConfig> | undefined;

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

  return {
    ...DEFAULT_CONFIG,
    ...global,
    ...project,
  };
}
