import { loadPiConfig } from "@mammothb/pi-shared";
import type { LanguageId, ReadConfig } from "./types.js";

export const DEFAULT_CONFIG: ReadConfig = {
  enabled: true,
  // Aligned with the built-in read truncation limits (2000 lines / 50KB):
  // below both, the original read returns the full file anyway, so outlining
  // only adds value past these.
  thresholdLines: 2000,
  thresholdBytes: 50 * 1024,
  maxDepth: 10,
  languages: {
    typescript: true,
    tsx: true,
    javascript: true,
    csharp: true,
    python: true,
    rust: true,
  },
};

function mergeConfig(
  base: ReadConfig,
  override: Record<string, unknown>,
): ReadConfig {
  const merged: ReadConfig = { ...base };

  if (typeof override.enabled === "boolean") {
    merged.enabled = override.enabled;
  }
  if (typeof override.thresholdLines === "number") {
    merged.thresholdLines = override.thresholdLines;
  }
  if (typeof override.thresholdBytes === "number") {
    merged.thresholdBytes = override.thresholdBytes;
  }
  if (typeof override.maxDepth === "number") {
    merged.maxDepth = override.maxDepth;
  }

  const languages = override.languages;
  if (languages !== null && typeof languages === "object") {
    merged.languages = { ...base.languages };
    for (const [key, value] of Object.entries(languages)) {
      if (typeof value === "boolean" && key in base.languages) {
        merged.languages[key as LanguageId] = value;
      }
    }
  }

  return merged;
}

/**
 * Load config from `.pi/pi-read.json` (project) over `~/.pi/agent/pi-read.json`
 * (global), falling back to {@link DEFAULT_CONFIG}.
 */
export function loadConfig(cwd: string): ReadConfig {
  return loadPiConfig("pi-read.json", cwd, DEFAULT_CONFIG, mergeConfig);
}
