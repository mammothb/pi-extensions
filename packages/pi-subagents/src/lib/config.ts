import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfigFile } from "@mammothb/pi-shared";
import type { SubagentConfig } from "./types.js";

const DEFAULTS: SubagentConfig = {
  tiers: {},
  stuckTimeoutMs: 60_000,
};

function parseTiers(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn(
      `subagents: "tiers" must be an object, got ${Array.isArray(raw) ? "array" : typeof raw} — using defaults`,
    );
    return {};
  }

  const tiers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      tiers[key] = value;
    } else {
      console.warn(
        `subagents: ignoring tier "${key}" — value must be a string, got ${typeof value}`,
      );
    }
  }
  return tiers;
}

function parseStuckTimeout(raw: unknown): number {
  if (typeof raw === "number") {
    return raw;
  }
  console.warn(
    `subagents: "stuckTimeoutMs" must be a number, got ${typeof raw} — using default`,
  );
  return DEFAULTS.stuckTimeoutMs;
}

/**
 * Load subagent configuration from <agentDir>/subagents.json.
 * Returns defaults when the file is missing or malformed.
 *
 * @param agentDir Override the agent directory path (for testing).
 *                 Defaults to `getAgentDir()` from pi-coding-agent.
 */
export function loadSubagentConfig(agentDir?: string): SubagentConfig {
  const dir = agentDir ?? getAgentDir();
  const path = join(dir, "subagents.json");
  const raw = readConfigFile(path, "subagents");
  if (!raw) {
    return { ...DEFAULTS };
  }

  const tiers = raw.tiers !== undefined ? parseTiers(raw.tiers) : {};
  const stuckTimeoutMs =
    raw.stuckTimeoutMs !== undefined
      ? parseStuckTimeout(raw.stuckTimeoutMs)
      : DEFAULTS.stuckTimeoutMs;

  return { tiers, stuckTimeoutMs };
}
