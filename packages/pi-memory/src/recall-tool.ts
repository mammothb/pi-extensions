import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getActiveLineageEntryIds } from "./lib/recall/lineage";
import { runRecallPipeline } from "./lib/recall/recall-pipeline";
import { normalizeRecallScope } from "./lib/recall/recall-scope";

export const registerRecallTool = (pi: ExtensionAPI) => {
  pi.registerTool({
    name: "mm_recall",
    label: "Memory Recall",
    description:
      "Recall earlier parts of the current session — decisions made, files touched, commands run, " +
      "including anything dropped by compaction. Reach for this before telling the user you no longer " +
      "have the context. Plain keywords work best; a regex pattern is also accepted. Results are paged " +
      "(page); pass expand with entry indices to read full untruncated content. Only the current session " +
      "is searchable — earlier sessions are not.",
    promptSnippet:
      "mm_recall: recall earlier parts of this session before saying the context is gone. " +
      "Plain keywords work best; scope:'all' widens to other conversation branches.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "What to recall, in plain keywords (e.g. 'redis cache decision'). Multi-word queries are ranked by relevance. A regex pattern also works.",
        }),
      ),
      expand: Type.Optional(
        Type.Array(Type.Number(), {
          description: "Entry indices to return full untruncated content for",
        }),
      ),
      page: Type.Optional(
        Type.Number({
          description:
            "Page number (1-based) for paginated search results. Default: 1.",
        }),
      ),
      scope: Type.Optional(
        Type.Union([Type.Literal("lineage"), Type.Literal("all")], {
          description:
            "Default 'lineage' covers the active conversation path. Use 'all' to also reach messages from other branches, such as turns that were edited or retried.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        return {
          content: [{ type: "text", text: "No session file available." }],
          details: undefined,
        };
      }

      const scope = normalizeRecallScope(params.scope);
      const lineageEntryIds =
        scope === "lineage"
          ? getActiveLineageEntryIds(ctx.sessionManager)
          : undefined;
      const page = params.page ?? 1;

      let continuationPrompt: string | undefined;
      if (params.query && page) {
        const scopeHint = scope === "all" ? " with scope:'all'" : "";
        continuationPrompt = `Use page:${page + 1}${scopeHint} for more results`;
      }

      const { text } = runRecallPipeline({
        sessionFile,
        query: params.query,
        scope,
        lineageEntryIds,
        page,
        expand: params.expand,
        continuationPrompt,
      });

      return {
        content: [{ type: "text", text }],
        details: undefined,
      };
    },
  });
};
