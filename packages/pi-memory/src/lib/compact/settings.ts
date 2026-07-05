import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const SETTINGS_PATH_DEFAULT = join(
  homedir(),
  ".pi",
  "agent",
  "pi-memory.json",
);
const settingsPath = (): string =>
  process.env.PI_MEMORY_CONFIG_PATH ?? SETTINGS_PATH_DEFAULT;
/** Backwards-compat export. Resolves at access time, not import time. */
export const SETTINGS_PATH = settingsPath();

export interface MmCompactSettings {
  /**
   * When true, mm-compact handles ALL compactions:
   *   - /compact (no args)
   *   - /compact <text>
   *   - auto threshold / overflow
   *   - /mm-compact (always handled regardless)
   *
   * When false (default), mm-compact only handles /mm-compact; everything else
   * falls back to pi core's default LLM-based compaction.
   */
  overrideDefaultCompaction: boolean;
  /** Write debug snapshot to /tmp/mm-compact-debug.json on each compaction. */
  debug: boolean;
}

export const DEFAULT_SETTINGS: MmCompactSettings = {
  overrideDefaultCompaction: false,
  debug: false,
};

const readJson = (path: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
};

export function loadSettings(): MmCompactSettings {
  const parsed = readJson(settingsPath());
  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...(parsed as Partial<MmCompactSettings>) };
}

/**
 * Ensure ~/.pi/agent/pi-memory.json exists with default keys.
 * - File missing → create with full default block.
 * - File exists but invalid JSON → no-op (don't clobber user file).
 * - File exists and valid → fill in missing default keys, preserve existing values.
 */
export function scaffoldSettings(): void {
  try {
    const path = settingsPath();
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(path)) {
      writeFileSync(path, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`);
      return;
    }

    const parsed = readJson(path);
    if (!parsed || typeof parsed !== "object") {
      return; // don't clobber
    }

    let changed = false;
    const next: Record<string, unknown> = { ...parsed };
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(key in next)) {
        next[key] = value;
        changed = true;
      }
    }
    if (changed) {
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    }
  } catch {
    // best-effort; never crash extension load
  }
}
