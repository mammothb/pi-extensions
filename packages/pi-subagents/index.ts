import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./src/lib/agents.js";
import {
  computeRosterChange,
  EMPTY_ROSTER_MESSAGE,
  formatAgentRoster,
} from "./src/lib/ambient.js";
import { createSubagentTool } from "./src/subagent-tool.js";

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.registerTool(createSubagentTool());

  // Ambient awareness: inject available agents into parent LLM context each turn.
  // Uses content-based change detection: identical roster is not re-injected.
  let lastRosterSignature: string | null = null;

  pi.on("before_agent_start", (_event, ctx) => {
    const agents = discoverAgents(ctx.cwd);
    const roster = formatAgentRoster(agents);

    const { shouldInject, newSignature } = computeRosterChange(
      roster,
      lastRosterSignature,
    );
    lastRosterSignature = newSignature;

    if (!shouldInject) {
      return;
    }

    // Use the empty-roster message when agents have been removed (roster
    // is empty but computeRosterChange requested injection for revocation).
    const content = roster || EMPTY_ROSTER_MESSAGE;

    return {
      message: {
        customType: "subagent_roster",
        content,
        display: false,
      },
    };
  });
}
