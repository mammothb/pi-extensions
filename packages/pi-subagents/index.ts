import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createIPC } from "./src/lib/research-ipc.js";
import {
  createResearchCloseHandler,
  createResearchHandler,
  createRshReportHandler,
} from "./src/research-commands.js";

export default function subagentsExtension(pi: ExtensionAPI) {
  const ipc = createIPC();

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
  pi.registerCommand("rsh-report", {
    description:
      "Send research findings back to the parent session. " +
      "Run this in the research child pane after completing your investigation.",
    handler: createRshReportHandler(pi, ipc),
  });

  // Poll for completed research reports before each agent turn
  pi.on("before_agent_start", async (_event, _ctx) => {
    const reports = await ipc.poll();
    const report = reports.at(-1);
    if (report === undefined) {
      return;
    }
    return {
      message: {
        customType: "research_complete",
        content: `**Research completed:** ${report.task}\n\n${report.output}`,
        display: true,
      },
    };
  });
}
