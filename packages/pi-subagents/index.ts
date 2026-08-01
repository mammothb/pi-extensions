import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createIPC } from "./src/lib/research-ipc.js";
import {
  createResearchCloseHandler,
  createResearchHandler,
  createResearchReportHandler,
  RSH_COMMANDS,
} from "./src/research-commands.js";

export default function subagentsExtension(pi: ExtensionAPI) {
  const ipc = createIPC();

  // Interactive research commands
  pi.registerCommand(RSH_COMMANDS.research, {
    description: `Fork an interactive session with tmux. Use /${RSH_COMMANDS.report} to send findings here.`,
    handler: createResearchHandler(pi),
  });
  pi.registerCommand(RSH_COMMANDS.close, {
    description:
      "Close a research session and clean up its state. Specify a session id, or omit to see active sessions.",
    handler: createResearchCloseHandler(pi),
  });
  pi.registerCommand(RSH_COMMANDS.report, {
    description: "Report research findings back to the parent session.",
    handler: createResearchReportHandler(pi, ipc),
  });

  // Poll for completed research reports before each agent turn
  pi.on("before_agent_start", async () => {
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
