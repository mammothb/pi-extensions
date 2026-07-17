import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { expandTilde, readConfigFile } from "@mammothb/pi-shared";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { BwBinds, BwRawConfig, BwResolvedConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and merge bw config: default → global → workspace.
 *
 * @param cwd Workspace root (used for resolving relative paths and locating .pi/bw.json)
 */
export function loadConfig(cwd: string): BwResolvedConfig {
  const globalPath = join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "bw",
    "config.json",
  );
  const workspacePath = join(cwd, ".pi", "bw.json");

  const globalRaw = readConfigFile(globalPath, "bw") as BwRawConfig | null;
  const workspaceRaw = readConfigFile(
    workspacePath,
    "bw",
  ) as BwRawConfig | null;

  let resolved = structuredClone(DEFAULT_CONFIG);

  if (globalRaw) {
    resolved = applyLayer(resolved, globalRaw);
  }
  if (workspaceRaw) {
    resolved = applyLayer(resolved, workspaceRaw);
  }

  // Auto-detect WSL2 and add binds/env if applicable
  if (isWsl2()) {
    applyWsl2(resolved);
  }

  expandPaths(resolved, cwd);

  return resolved;
}

// ---------------------------------------------------------------------------
// Layer application
// ---------------------------------------------------------------------------

function applyLayer(
  base: BwResolvedConfig,
  layer: BwRawConfig,
): BwResolvedConfig {
  let result = base;

  // binds: full replace (if present)
  if (layer.binds) {
    result = { ...result, binds: emptyBinds() };
    mergeBindsInto(result.binds, layer.binds);
  }

  // binds_extra: merge on top
  if (layer.binds_extra) {
    mergeBindsInto(result.binds, layer.binds_extra);
  }

  // options: shallow merge
  if (layer.options) {
    result = {
      ...result,
      options: {
        ...result.options,
        ...layer.options,
        env: layer.options.env
          ? { ...result.options.env, ...layer.options.env }
          : result.options.env,
      },
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bind merging
// ---------------------------------------------------------------------------

function emptyBinds(): BwResolvedConfig["binds"] {
  return {
    ro: [],
    roTry: [],
    rw: [],
    docker: null,
    wsl2: { ro: [], roTry: [] },
  };
}

function mergeBindsInto(
  target: BwResolvedConfig["binds"],
  source: BwBinds,
): void {
  if (source.ro) {
    target.ro.push(...source.ro);
  }
  if (source.roTry) {
    target.roTry.push(...source.roTry);
  }
  if (source.rw) {
    target.rw.push(...source.rw);
  }
  if (source.docker !== undefined) {
    target.docker = source.docker;
  }
  if (source.wsl2) {
    target.wsl2 = {
      ro: source.wsl2.ro
        ? [...target.wsl2.ro, ...source.wsl2.ro]
        : target.wsl2.ro,
      roTry: source.wsl2.roTry
        ? [...target.wsl2.roTry, ...source.wsl2.roTry]
        : target.wsl2.roTry,
    };
  }
}

// ---------------------------------------------------------------------------
// WSL2 detection
// ---------------------------------------------------------------------------

function isWsl2(): boolean {
  try {
    return (
      existsSync("/init") &&
      existsSync("/run/WSL") &&
      readdirSync("/run/WSL").length > 0 &&
      existsSync("/proc/sys/fs/binfmt_misc/WSLInterop")
    );
  } catch {
    return false;
  }
}

const WSL2_BINDS = {
  ro: ["/init", "/run/WSL"],
  roTry: ["/mnt/c", "/mnt/wsl"],
};

const WSL2_ENV = ["WSL_INTEROP", "WSL_DISTRO_NAME", "WSLENV"];

function applyWsl2(config: BwResolvedConfig): void {
  const hasCustomWsl2 =
    config.binds.wsl2.ro.length > 0 || config.binds.wsl2.roTry.length > 0;

  if (!hasCustomWsl2) {
    config.binds.wsl2.ro.push(...WSL2_BINDS.ro);
    config.binds.wsl2.roTry.push(...WSL2_BINDS.roTry);
  }

  for (const key of WSL2_ENV) {
    const val = process.env[key];
    if (val && !(key in config.options.env)) {
      config.options.env[key] = val;
    }
  }
}

// ---------------------------------------------------------------------------
// Path expansion & validation
// ---------------------------------------------------------------------------

function expandPaths(config: BwResolvedConfig, cwd: string): void {
  for (const key of ["ro", "roTry", "rw"] as const) {
    config.binds[key] = config.binds[key].map((p) => resolvePath(p, cwd));
  }
  if (config.binds.docker) {
    config.binds.docker = resolvePath(config.binds.docker, cwd);
  }
  for (const key of ["ro", "roTry"] as const) {
    config.binds.wsl2[key] = config.binds.wsl2[key].map((p) =>
      resolvePath(p, cwd),
    );
  }
  if (config.options.seccomp) {
    config.options.seccomp = resolvePath(config.options.seccomp, cwd);
  }
}

function resolvePath(raw: string, cwd: string): string {
  const expanded = expandTilde(raw);
  if (!isAbsolute(expanded)) {
    return resolve(cwd, expanded);
  }
  return expanded;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  path: string;
  kind: "ro" | "rw";
  source: "global" | "workspace";
  index: number;
}

/**
 * Validate that required bind paths exist. Only checks entries from a specific
 * user config source (global or workspace). Defaults and WSL2 auto-binds are
 * assumed valid.
 */
export function validatePaths(
  rawConfig: BwRawConfig,
  cwd: string,
  source: "global" | "workspace",
): ValidationError[] {
  const errors: ValidationError[] = [];
  const bindSource = rawConfig.binds ?? rawConfig.binds_extra;
  if (!bindSource) {
    return errors;
  }

  for (const key of ["ro", "rw"] as const) {
    const entries = bindSource[key];
    if (!entries) {
      continue;
    }
    for (let i = 0; i < entries.length; i++) {
      const p = entries[i];
      if (!p) {
        continue;
      }
      const final = resolvePath(p, cwd);
      if (!existsSync(final)) {
        errors.push({ path: final, kind: key, source, index: i });
      }
    }
  }

  return errors;
}
