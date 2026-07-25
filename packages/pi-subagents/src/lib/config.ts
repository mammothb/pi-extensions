import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfigFile } from "@mammothb/pi-shared";
import type { SubagentConfig } from "./types.js";

const DEFAULTS: SubagentConfig = {
  tiers: {},
  stuckTimeoutMs: 60_000,
};

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

  let tiers: Record<string, string> = {};
  if (raw.tiers !== undefined) {
    if (
      typeof raw.tiers === "object" &&
      raw.tiers !== null &&
      !Array.isArray(raw.tiers)
    ) {
      tiers = {};
      for (const [key, value] of Object.entries(
        raw.tiers as Record<string, unknown>,
      )) {
        if (typeof value === "string") {
          tiers[key] = value;
        } else {
          console.warn(
            `subagents: ignoring tier "${key}" — value must be a string, got ${typeof value}`,
          );
        }
      }
    } else {
      console.warn(
        `subagents: "tiers" must be an object, got ${Array.isArray(raw.tiers) ? "array" : typeof raw.tiers} — using defaults`,
      );
    }
  }

  let stuckTimeoutMs = DEFAULTS.stuckTimeoutMs;
  if (raw.stuckTimeoutMs !== undefined) {
    if (typeof raw.stuckTimeoutMs === "number") {
      stuckTimeoutMs = raw.stuckTimeoutMs;
    } else {
      console.warn(
        `subagents: "stuckTimeoutMs" must be a number, got ${typeof raw.stuckTimeoutMs} — using default`,
      );
    }
  }

  return { tiers, stuckTimeoutMs };
}
