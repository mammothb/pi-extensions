import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfigFile } from "@mammothb/pi-shared";
import type { SubagentConfig } from "./types.js";

const DEFAULTS: SubagentConfig = {
  tiers: {},
  stuckTimeoutMs: 60_000,
};

/**
 * Load subagent configuration from ~/.pi/agent/subagents.json.
 * Returns defaults when the file is missing or malformed.
 */
export function loadSubagentConfig(): SubagentConfig {
  const path = join(getAgentDir(), "subagents.json");
  const raw = readConfigFile(path, "subagents");
  if (!raw) {
    return { ...DEFAULTS };
  }
  return {
    tiers: (raw.tiers as Record<string, string>) ?? {},
    stuckTimeoutMs: (raw.stuckTimeoutMs as number) ?? DEFAULTS.stuckTimeoutMs,
  };
}
