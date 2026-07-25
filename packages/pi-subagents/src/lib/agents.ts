import type { AgentConfig } from "./types.js";

/**
 * Discover and parse all agent definition files.
 * Scans user-level (~/.pi/agent/agents/) and project-level (.pi/agents/) directories.
 * Project agents override user agents with the same name.
 */
export function discoverAgents(_cwd: string): AgentConfig[] {
  // TODO: implement in later phases
  return [];
}
