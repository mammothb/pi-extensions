import { loadPiConfig } from "@mammothb/pi-shared";

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
 * Load config from JSON files. Project config (`.pi/pi-ghsearch.json`)
 * overrides global config (`~/.pi/agent/pi-ghsearch.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadConfig(cwd: string): GhSearchConfig {
  return loadPiConfig(
    "pi-ghsearch.json",
    cwd,
    { ...DEFAULT_CONFIG, defaults: { ...DEFAULT_CONFIG.defaults } },
    mergeConfig,
  );
}
