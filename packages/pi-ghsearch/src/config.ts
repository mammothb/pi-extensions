import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface GhSearchConfig {
  /**
   * When set, ALL searches are restricted to repos within this
   * GitHub organization. gh_search automatically adds --owner <org> to every
   * command.
   *
   * gh_fetch and gh_auth_status are NOT affected by this setting.
   *
   * Leave unset (or omit) for unrestricted access.
   */
  organization?: string;

  /**
   * When true, blocks model-initiated bash executions of `gh search`,
   * `gh api`, and `gh auth` and redirects to gh_search / gh_fetch /
   * gh_auth_status instead. Other gh commands (gh repo clone, gh issue
   * create, gh pr list, etc.) are unaffected.
   *
   * The extension's own `gh auth status` check at session_start is not
   * affected — it uses pi.exec directly, not a model tool call.
   *
   * Default: false (soft-nudge via prompt guidelines only).
   */
  banBashGh?: boolean;

  /**
   * Default timeout for gh CLI commands in milliseconds.
   */
  timeoutMs: number;

  /**
   * Default values that apply to search/fetch parameters when the user
   * doesn't supply them explicitly.
   */
  defaults: {
    /** Default max results per search (maps to gh --limit). */
    limit: number;
  };
}

export const DEFAULT_CONFIG: GhSearchConfig = {
  // organization is undefined by default (no restriction)
  // banBashGh is undefined by default (no blocking)
  timeoutMs: 30_000, // matches current COMMON_TIMEOUT_MS
  defaults: {
    limit: 30, // gh CLI default is 30
  },
};

async function tryReadJson(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    // File not found — no config to load, not an error
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    // Parse error — warn and fall back
    console.warn(
      `pi-ghsearch: failed to parse config at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function mergeConfig(
  base: GhSearchConfig,
  overrides: Record<string, unknown>,
): GhSearchConfig {
  const merged: GhSearchConfig = {
    ...base,
    defaults: { ...base.defaults },
  };

  if (typeof overrides.organization === "string") {
    merged.organization = overrides.organization;
  }
  if (typeof overrides.banBashGh === "boolean") {
    merged.banBashGh = overrides.banBashGh;
  }
  if (typeof overrides.timeoutMs === "number") {
    merged.timeoutMs = overrides.timeoutMs;
  }
  if (overrides.defaults && typeof overrides.defaults === "object") {
    const d = overrides.defaults as Record<string, unknown>;
    if (typeof d.limit === "number") {
      merged.defaults = { limit: d.limit };
    }
  }

  return merged;
}

/**
 * Load config from two locations (project overrides global, global overrides defaults).
 * Returns the merged config. Logs warnings on parse errors, proceeds with defaults.
 *
 * @param cwd - Current working directory (for project-level config)
 * @param home - Home directory (for global config). Defaults to homedir().
 */
export async function loadConfig(
  cwd: string,
  home?: string,
): Promise<GhSearchConfig> {
  let config: GhSearchConfig = {
    ...DEFAULT_CONFIG,
    defaults: { ...DEFAULT_CONFIG.defaults },
  };

  // Load global config (~/.pi/agent/pi-ghsearch.json)
  const globalPath = join(
    home ?? homedir(),
    ".pi",
    "agent",
    "pi-ghsearch.json",
  );
  const globalConfig = await tryReadJson(globalPath);
  if (globalConfig) {
    config = mergeConfig(config, globalConfig);
  }

  // Load project config (<cwd>/.pi/pi-ghsearch.json) — overrides global
  const projectPath = join(cwd, ".pi", "pi-ghsearch.json");
  const projectConfig = await tryReadJson(projectPath);
  if (projectConfig) {
    config = mergeConfig(config, projectConfig);
  }

  return config;
}
