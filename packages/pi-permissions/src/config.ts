import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { expandTilde, readConfigFile } from "@mammothb/pi-shared";
import type {
  PermissionConfig,
  PermissionState,
  ResolvedConfig,
} from "./lib/types.js";

const DEFAULTS = {
  tools: "ask" as PermissionState,
  bash: "ask" as PermissionState,
  paths: "ask" as PermissionState,
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  defaults: DEFAULTS,
  tools: {},
  paths: {},
};

/**
 * Load config from JSON files. Project config (`.pi/pi-permissions.json`)
 * overrides global config (`~/.pi/agent/pi-permissions.json`).
 *
 * Returns the fully resolved config with all defaults applied.
 */
export function loadConfig(cwd: string): ResolvedConfig {
  const globalPath = join(getAgentDir(), "pi-permissions.json");
  const projectPath = join(cwd, ".pi", "pi-permissions.json");

  const globalConfig = readConfigFile(
    globalPath,
    "pi-permissions",
  ) as PermissionConfig | null;
  const projectConfig = readConfigFile(
    projectPath,
    "pi-permissions",
  ) as PermissionConfig | null;

  return resolveConfig(
    cwd,
    globalConfig ?? undefined,
    projectConfig ?? undefined,
  );
}

/**
 * Merge global and project config into a resolved config with defaults.
 *
 * Project overrides global. If no config is provided, uses all defaults.
 * The arbiter path is resolved relative to cwd (with tilde expansion).
 */
export function resolveConfig(
  cwd: string,
  globalConfig?: PermissionConfig,
  projectConfig?: PermissionConfig,
): ResolvedConfig {
  const tools = {
    ...(globalConfig?.tools ?? {}),
    ...(projectConfig?.tools ?? {}),
  };

  const paths = {
    ...(globalConfig?.paths ?? {}),
    ...(projectConfig?.paths ?? {}),
  };

  const defaults = {
    tools:
      projectConfig?.defaults?.tools ??
      globalConfig?.defaults?.tools ??
      DEFAULTS.tools,
    bash:
      projectConfig?.defaults?.bash ??
      globalConfig?.defaults?.bash ??
      DEFAULTS.bash,
    paths:
      projectConfig?.defaults?.paths ??
      globalConfig?.defaults?.paths ??
      DEFAULTS.paths,
  };

  // Arbiter path: project overrides global. Expand ~ and resolve relative to cwd.
  const rawArbiterPath =
    projectConfig?.bash?.arbiter ?? globalConfig?.bash?.arbiter;
  let bashArbiterPath: string | undefined;
  if (rawArbiterPath) {
    bashArbiterPath = resolve(cwd, expandTilde(rawArbiterPath));
  }

  return { defaults, tools, bashArbiterPath, paths };
}
