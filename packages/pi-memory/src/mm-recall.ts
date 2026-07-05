import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getActiveLineageEntryIds } from "./lib/recall/lineage";
import { runRecallPipeline } from "./lib/recall/recall-pipeline";
import { parseRecallScope } from "./lib/recall/recall-scope";

export const registerMmRecallCommand = (pi: ExtensionAPI) => {
  pi.registerCommand("mm-recall", {
    description:
      "Search session history. Defaults to active lineage; add scope:all for off-lineage branches.",
    handler: async (args: string, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("No session file available.", "error");
        return;
      }

      const raw = args.trim();
      const parsed = parseRecallScope(raw);
      const lineageEntryIds =
        parsed.scope === "lineage"
          ? getActiveLineageEntryIds(ctx.sessionManager)
          : undefined;

      // Parse page:N from args
      const pageMatch = parsed.text.match(/\bpage:(\d+)\b/i);
      const page = pageMatch?.[1]
        ? Math.max(1, parseInt(pageMatch[1], 10))
        : undefined;
      const query =
        parsed.text.replace(/\bpage:\d+\b/i, "").trim() || undefined;

      const continuationPrompt =
        query && parsed.scope !== "all"
          ? `/mm-recall ${query} page:`
          : query
            ? `/mm-recall ${query} scope:all page:`
            : undefined;

      const { text } = runRecallPipeline({
        sessionFile,
        query,
        scope: parsed.scope,
        lineageEntryIds,
        page,
        continuationPrompt: continuationPrompt
          ? `${continuationPrompt}${(page ?? 1) + 1}`
          : undefined,
      });

      pi.sendMessage(
        {
          customType: "mm-recall",
          content: text,
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });
};
