import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { loadPiConfig } from "@mammothb/pi-shared";
import type { LanguageId, ReadConfig } from "./types.js";

export const DEFAULT_CONFIG: ReadConfig = {
  enabled: true,
  // Aligned with the built-in read truncation limits: below both, the built-in
  // read returns the full file anyway, so outlining only adds value past these.
  thresholdLines: DEFAULT_MAX_LINES,
  thresholdBytes: DEFAULT_MAX_BYTES,
  maxBytes: 10 * 1024 * 1024,
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

/** Non-negative safe integer (thresholds). */
function isNonNegativeSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Positive safe integer (maxBytes, maxDepth). */
function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function mergeConfig(
  base: ReadConfig,
  override: Record<string, unknown>,
): ReadConfig {
  const merged: ReadConfig = { ...base };

  if (typeof override.enabled === "boolean") {
    merged.enabled = override.enabled;
  }
  if (isNonNegativeSafeInt(override.thresholdLines)) {
    merged.thresholdLines = override.thresholdLines;
  }
  if (isNonNegativeSafeInt(override.thresholdBytes)) {
    merged.thresholdBytes = override.thresholdBytes;
  }
  if (isPositiveSafeInt(override.maxBytes)) {
    merged.maxBytes = override.maxBytes;
  }
  if (isPositiveSafeInt(override.maxDepth)) {
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
