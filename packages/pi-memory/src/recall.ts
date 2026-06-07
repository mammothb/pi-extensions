import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { extractTextContent, renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import { searchMemory } from "./lib/search.js";
import { loadGlobalMemory, loadMemory } from "./lib/store.js";

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

interface MemoryEntry {
  value: string;
  source: "global" | "project";
}

/**
 * Merge global and project memory. Project entries override global
 * entries with the same key. Tracks source for display labels.
 */
function mergedMemory(
  cwd: string,
  baseDir?: string,
): Record<string, MemoryEntry> {
  const global = loadGlobalMemory(baseDir);
  const project = loadMemory(cwd, baseDir);

  // Start with all global entries
  const merged: Record<string, MemoryEntry> = {};
  for (const [key, value] of Object.entries(global)) {
    merged[key] = { value, source: "global" };
  }
  // Overlay project entries (overrides on conflict)
  for (const [key, value] of Object.entries(project)) {
    merged[key] = { value, source: "project" };
  }
  return merged;
}

/** Convert MemoryEntry map to a plain Record<string, string> for search. */
function toSearchMemory(
  entries: Record<string, MemoryEntry>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(entries)) {
    result[key] = entry.value;
  }
  return result;
}

/**
 * Filter entries to keys matching the namespace prefix.
 */
function filterByNamespace(
  entries: Record<string, MemoryEntry>,
  namespace: string,
): Record<string, MemoryEntry> {
  const result: Record<string, MemoryEntry> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (key.startsWith(namespace)) {
      result[key] = entry;
    }
  }
  return result;
}

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
  source: "global" | "project",
  namespace?: string,
): string {
  const displayKey = namespace ? stripNamespace(key, namespace) : key;
  const label = source === "global" ? "(global)" : "(project)";
  return `${label} ${displayKey}`;
}

export function createRecallTool(
  baseDir?: string,
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
    renderCall(args, theme, _context) {
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
    renderResult(result, _options, theme, context) {
      if (context.isError) {
        return renderError("Recall failed", theme);
      }

      const textContent = extractTextContent(result);

      if (!textContent) {
        return new Text(theme.fg("muted", "No results"), 0, 0);
      }

      return new Text(textContent, 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      let entries = mergedMemory(ctx.cwd, baseDir);
      const namespace = params.namespace;

      // Filter by namespace if provided
      if (namespace) {
        entries = filterByNamespace(entries, namespace);
      }

      const keys = Object.keys(entries);

      // List mode
      if (params.list) {
        if (keys.length === 0) {
          const nsMsg = namespace
            ? `No memory entries found for namespace "${namespace}".`
            : "No memory entries found for this project.";
          return {
            content: [{ type: "text", text: nsMsg }],
            details: {},
          };
        }
        const lines = keys
          .sort()
          .map((k) => {
            const entry = entries[k];
            if (!entry) return null;
            const keyDisplay = formatKey(k, entry.source, namespace);
            const preview =
              entry.value.length > MAX_PREVIEW
                ? `${entry.value.slice(0, MAX_PREVIEW)}…`
                : entry.value;
            return `${keyDisplay}: ${preview}`;
          })
          .filter((l): l is string => l !== null);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {},
        };
      }

      // Search mode
      if (!params.query || params.query.trim().length === 0) {
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

      const searchInput = toSearchMemory(entries);
      const results = searchMemory(searchInput, params.query);

      if (results.length === 0) {
        const nsMsg = namespace
          ? `No relevant memory found in namespace "${namespace}".`
          : "No relevant memory found.";
        return {
          content: [{ type: "text", text: nsMsg }],
          details: {},
        };
      }

      const lines = results
        .map((r) => {
          const entry = entries[r.key];
          if (!entry) return null;
          const keyDisplay = formatKey(r.key, entry.source, namespace);
          return `[score: ${r.score}] ${keyDisplay}: ${r.valuePreview}`;
        })
        .filter((l): l is string => l !== null);
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {},
      };
    },
  };
}
