import type { AgentConfig } from "./types.js";

/**
 * Determine whether a roster should be injected based on content change.
 * - First non-empty roster → inject
 * - Same roster as last time → skip
 * - Different roster → inject
 * - Roster cleared (non-empty → empty) → skip, signature cleared
 */
export function computeRosterChange(
  roster: string,
  lastSignature: string | null,
): { shouldInject: boolean; newSignature: string | null } {
  if (!roster) {
    // Empty roster: never inject, but clear signature so a future non-empty
    // roster (when agents are added) will be injected.
    return { shouldInject: false, newSignature: null };
  }

  if (roster === lastSignature) {
    return { shouldInject: false, newSignature: lastSignature };
  }

  return { shouldInject: true, newSignature: roster };
}

/**
 * Format a roster of available agents for injection into the parent LLM context.
 * Only agents with a non-empty `description` are included.
 * Returns an empty string if no agents qualify.
 */
export function formatAgentRoster(agents: AgentConfig[]): string {
  const qualifying = agents
    .filter((a) => a.description.trim().length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (qualifying.length === 0) {
    return "";
  }

  const lines = qualifying.map((a) => `- **${a.name}**: ${a.description}`);

  return `\n\n<context name="subagent-roster">\n${lines.join("\n")}\n</context>\n`;
}
