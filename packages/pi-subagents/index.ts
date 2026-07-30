import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./src/lib/agents.js";
import {
  computeRosterChange,
  EMPTY_ROSTER_MESSAGE,
  formatAgentRoster,
} from "./src/lib/ambient.js";
import {
  createResearchCloseHandler,
  createResearchHandler,
} from "./src/research-commands.js";
import { createResumeTool } from "./src/resume-tool.js";
import { createSubagentTool } from "./src/subagent-tool.js";

export default function subagentsExtension(pi: ExtensionAPI) {
  pi.registerTool(createSubagentTool());
  pi.registerTool(createResumeTool());

  // Interactive research commands
  pi.registerCommand("rsh", {
    description:
      "Fork the current session into an interactive tmux pane for open-ended research. " +
      "You steer the child pi directly, then use /rsh-report to send findings here.",
    handler: createResearchHandler(pi),
  });
  pi.registerCommand("rsh-close", {
    description:
      "Close a research session pane and clean up its state. " +
      "Specify a session id, or omit to see active sessions.",
    handler: createResearchCloseHandler(pi),
  });

  // Ambient awareness: inject available agents + task classification
  // heuristic into parent LLM context each turn.
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
    const agentList = roster || EMPTY_ROSTER_MESSAGE;

    // Task classification heuristic: helps the model decide between
    // autonomous subagent tool vs interactive /research command.
    const classificationHint =
      "\n\nBefore delegating, classify the task:\n" +
      "- MECHANICAL (clear inputs, clear outputs, routine) → use subagent tool\n" +
      "- EXPLORATORY (open-ended, needs steering, iterative) → use /research command\n";

    const content = `${classificationHint}\n${agentList}`;

    return {
      message: {
        customType: "subagent_roster",
        content,
        display: false,
      },
    };
  });
}
