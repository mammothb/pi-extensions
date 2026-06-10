import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { extractTextContent, renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import type { MemoryBackend, MemoryScope } from "./lib/backend.js";

const Parameters = Type.Object({
  query: Type.Optional(
    Type.String({ description: "Search query for keyword-based recall" }),
  ),
  list: Type.Optional(
    Type.Boolean({ description: "List all memory keys with value previews" }),
  ),
  namespace: Type.Optional(
    Type.String({
      description:
        "Filter results to keys starting with this prefix (e.g. 'project:', 'user:', 'convention:', 'reflection-')",
    }),
  ),
});

const MAX_PREVIEW = 80;

/**
 * Strip a namespace prefix from a key for display.
 * e.g. "project:build-command" → "build-command" when namespace is "project:"
 */
function stripNamespace(key: string, namespace: string): string {
  if (key.startsWith(namespace)) {
    return key.slice(namespace.length);
  }
  return key;
}

/** Format a key for display with optional namespace stripping and source label. */
function formatKey(
  key: string,
  scope: MemoryScope,
  namespace?: string,
): string {
  const displayKey = namespace ? stripNamespace(key, namespace) : key;
  const label = scope === "global" ? "(global)" : "(project)";
  return `${label} ${displayKey}`;
}

export function createRecallTool(
  backend: MemoryBackend,
): ToolDefinition<typeof Parameters> {
  return {
    name: "recall",
    label: "Recall",
    description:
      "Search persistent memory by keyword or list all entries. Returns scored, ranked results " +
      "merged from both project-scoped and global memory. " +
      "Project entries override global entries with the same key.",
    promptSnippet: "Search or list persistent memory by keyword",
    promptGuidelines: [
      "Use recall to find previously retained facts, conventions, and reflections.",
      "The query matches against both keys and values, with key matches ranked higher.",
      "Use list: true to see all stored entries.",
      "Use the namespace parameter to filter by key prefix — e.g. namespace: 'project:' shows only project-level conventions.",
      "Common namespaces: 'project:' (build commands, structure), 'user:' (preferences), 'convention:' (coding patterns), 'reflection-' (conversation learnings).",
      "Results include both project and global memory. (global) entries are shared across all projects; (project) entries override global with the same key.",
    ],
    parameters: Parameters,
    renderCall(args, theme, _ctx) {
      const badge = args.list
        ? theme.fg("syntaxKeyword", "(list)")
        : args.query
          ? theme.fg("toolOutput", `"${args.query.slice(0, 40)}"`)
          : theme.fg("syntaxKeyword", "(?)");
      const ns = args.namespace
        ? ` ${theme.fg("muted", `ns:${args.namespace}`)}`
        : "";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("recall"))}  ${badge}${ns}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme, ctx) {
      if (ctx.isError) {
        return renderError("Recall failed", theme);
      }

      const textContent = extractTextContent(result);

      if (!textContent) {
        return new Text(theme.fg("muted", "No results"), 0, 0);
      }

      return new Text(textContent, 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { query, list, namespace } = params;

      const entries = await backend.recall({
        cwd: ctx.cwd,
        options: { query, list, namespace },
      });

      // List mode
      if (list) {
        if (entries.length === 0) {
          const nsMsg = namespace
            ? `No memory entries found for namespace "${namespace}".`
            : "No memory entries found for this project.";
          return {
            content: [{ type: "text", text: nsMsg }],
            details: {},
          };
        }
        const lines = entries.map((e) => {
          const keyDisplay = formatKey(e.key, e.scope, namespace);
          const preview =
            e.value.length > MAX_PREVIEW
              ? `${e.value.slice(0, MAX_PREVIEW)}…`
              : e.value;
          return `${keyDisplay}: ${preview}`;
        });
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {},
        };
      }

      // Search mode
      if (!query || query.trim().length === 0) {
        return {
          content: [
            {
              type: "text",
              text: 'Usage: provide a "query" for keyword search, set "list: true" to list all entries, or use "namespace" to filter by key prefix.',
            },
          ],
          details: {},
        };
      }

      if (entries.length === 0) {
        const nsMsg = namespace
          ? `No relevant memory found in namespace "${namespace}".`
          : "No relevant memory found.";
        return {
          content: [{ type: "text", text: nsMsg }],
          details: {},
        };
      }

      const lines = entries.map((e) => {
        const keyDisplay = formatKey(e.key, e.scope, namespace);
        const preview =
          e.value.length > MAX_PREVIEW
            ? `${e.value.slice(0, MAX_PREVIEW)}…`
            : e.value;
        const scoreStr = e.score != null ? `[score: ${e.score}] ` : "";
        return `${scoreStr}${keyDisplay}: ${preview}`;
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {},
      };
    },
  };
}
