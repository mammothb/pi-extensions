import type { AgentConfig } from "./types.js";

/**
 * Determine whether a roster should be injected based on content change.
 * - First non-empty roster → inject
 * - Same roster as last time → skip
 * - Different roster (including non-empty → empty revocation) → inject
 * - Persistent empty → skip
 */
export function computeRosterChange(
  roster: string,
  lastSignature: string | null,
): { shouldInject: boolean; newSignature: string | null } {
  if (!roster) {
    // Roster is empty now. If there was a previously published roster,
    // inject an empty roster so the LLM knows agents have been removed.
    // Otherwise (never had a roster), just skip.
    if (lastSignature !== null) {
      return { shouldInject: true, newSignature: null };
    }
    return { shouldInject: false, newSignature: null };
  }

  if (roster === lastSignature) {
    return { shouldInject: false, newSignature: lastSignature };
  }

  return { shouldInject: true, newSignature: roster };
}

/**
 * A minimal roster message used when all agents have been removed,
 * so the LLM knows no subagents are available.
 */
export const EMPTY_ROSTER_MESSAGE =
  '\n\n<context name="subagent-roster">\n(no subagents available)\n</context>\n';

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
