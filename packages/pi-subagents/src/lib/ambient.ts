import type { AgentConfig } from "./types.js";

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
