import type {
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
} from "@earendil-works/pi-coding-agent";
import { createIPC } from "./src/lib/research-ipc.js";
import { setResearchSessionChildPid } from "./src/lib/research-state.js";
import {
  closeResearchSessionById,
  createResearchCloseHandler,
  createResearchHandler,
  createResearchReportHandler,
  RSH_COMMANDS,
  sweepStaleResearchSessions,
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
    handler: createResearchReportHandler(ipc),
  });

  // Clean up research sessions left behind by unclean child exits (crash,
  // SIGKILL, power loss) — mirroring pi-web's searxng unclean-shutdown
  // audit at startup. Runs in every pi process, parent or child.
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    const cleaned = sweepStaleResearchSessions();
    if (cleaned > 0) {
      ctx.ui.notify(
        `pi-subagents: cleaned up ${cleaned} stale research session(s) from previous runs.`,
        "info",
      );
    }
  });

  // If this pi process IS a research child, clean up after itself when it
  // exits: session_shutdown covers graceful quit, SIGHUP/SIGTERM cover
  // pane death and kill. SIGKILL and crashes are caught by the sweep above
  // on the next startup.
  const childSessionId = process.env.PI_RSH_SESSION_ID;
  if (childSessionId) {
    setResearchSessionChildPid(childSessionId, process.pid);
    pi.on("session_shutdown", (event: SessionShutdownEvent) => {
      if (event.reason === "quit") {
        closeResearchSessionById(childSessionId);
      }
    });
    process.on("exit", () => {
      closeResearchSessionById(childSessionId);
    });
    for (const signal of ["SIGHUP", "SIGTERM"] as const) {
      process.on(signal, () => {
        closeResearchSessionById(childSessionId);
        process.exit(0);
      });
    }
  }

  // Push delivery — watch the reports dir and fire immediately when a
  // child sends findings home. Only the parent (not a research child
  // itself) needs to deliver reports. Uses the same onReport handler as
  // the poll fallback below — only one path delivers per report.
  if (!childSessionId) {
    ipc.onReport((report) => {
      pi.sendMessage({
        customType: "research_complete",
        content: `**Research completed:** ${report.task}\n\n${report.output}`,
        display: true,
      });
    });
    ipc.start();
  }

  // Poll fallback — catches reports written before the watcher started
  // (startup race) or dropped by the underlying fs.watch implementation.
  pi.on("before_agent_start", async () => {
    await ipc.poll();
  });
}
