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
      "Search session history. Defaults to active lineage; use scope:'all' to include off-lineage branches." +
      " Supports regex queries, paging, and expand indices.",
    promptSnippet:
      "mm_recall: Search history; default scope is active lineage. Use scope:'all' for off-lineage branches.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "Search terms or regex pattern (e.g. 'hook|inject', 'fail.*build'). Multi-word = OR ranked by relevance.",
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
            "Search scope. Default: lineage; all includes off-lineage branches.",
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

      const continuationPrompt =
        params.query && page
          ? `Use page:${page + 1}${scope === "all" ? " with scope:'all'" : ""} for more results`
          : undefined;

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
