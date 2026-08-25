import { loadPiConfig } from "@mammothb/pi-shared";

export interface SharepointConfig {
  /**
   * Microsoft Graph API root. Override for sovereign clouds, e.g.
   * "https://graph.microsoft.us" (GCC) or
   * "https://microsoftgraph.chinacloudapi.cn" (China).
   */
  baseUrl: string;
  /**
   * Bearer token source with indirection prefix:
   *   "env:VAR_NAME"  → process.env.VAR_NAME
   *   "file:/path"    → file contents (trimmed)
   *   "cmd:command"   → command stdout (trimmed)
   * Resolved at tool-execution time so rotated tokens are picked up.
   */
  tokenSource: string;
}

export interface OfficeConfig {
  sharepoint: SharepointConfig;
}

export const DEFAULT_CONFIG: OfficeConfig = {
  sharepoint: {
    baseUrl: "https://graph.microsoft.com/v1.0",
    tokenSource: "",
  },
};

function mergeConfig(
  base: OfficeConfig,
  override: Record<string, unknown>,
): OfficeConfig {
  const merged: OfficeConfig = { ...base };
  if (
    override.sharepoint &&
    typeof override.sharepoint === "object" &&
    !Array.isArray(override.sharepoint)
  ) {
    const sp = override.sharepoint as Record<string, unknown>;
    merged.sharepoint = {
      baseUrl:
        typeof sp.baseUrl === "string" ? sp.baseUrl : base.sharepoint.baseUrl,
      tokenSource:
        typeof sp.tokenSource === "string"
          ? sp.tokenSource
          : base.sharepoint.tokenSource,
    };
  }
  return merged;
}

/**
 * Load config from JSON files. Project config (`.pi/pi-office.json`)
 * overrides global config (`~/.pi/agent/pi-office.json`).
 *
 * Returns the default config if no config files exist.
 */
export function loadConfig(cwd: string): OfficeConfig {
  return loadPiConfig("pi-office.json", cwd, DEFAULT_CONFIG, mergeConfig);
}
