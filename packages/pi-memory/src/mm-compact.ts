import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  formatCompactionStats,
  getLastCompactionStats,
} from "./before-compact";
import {
  buildMmCompactInstructions,
  parseKeepAndPrompt,
} from "./lib/compact/compact-args";

export const registerMmCompactCommand = (pi: ExtensionAPI) => {
  pi.registerCommand("mm-compact", {
    description: "Compact conversation with mm-cli structured summary",
    handler: async (args: string, ctx) => {
      const { followUpPrompt, keepUserTurns } = parseKeepAndPrompt(args);
      ctx.compact({
        customInstructions: buildMmCompactInstructions(keepUserTurns),
        onComplete: () => {
          const stats = getLastCompactionStats();
          if (stats) {
            ctx.ui.notify(formatCompactionStats(stats), "info");
          } else {
            ctx.ui.notify("Compacted with mm-compact", "info");
          }
          if (followUpPrompt) {
            pi.sendUserMessage(followUpPrompt);
          }
        },
        onError: (err) => {
          if (
            err.message === "Compaction cancelled" ||
            err.message === "Already compacted"
          ) {
            ctx.ui.notify("Nothing to compact", "warning");
          } else {
            ctx.ui.notify(`Compaction failed: ${err.message}`, "error");
          }
        },
      });
    },
  });
};
