import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { extractTextContent, renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import type { MemoryBackend } from "./lib/backend.js";

const DEFAULT_THRESHOLD = 2000;

const Parameters = Type.Object({
  threshold: Type.Optional(
    Type.Number({
      description:
        "Character count threshold. Entries with values longer than this will be surfaced for compaction. Defaults to 2000.",
      exclusiveMinimum: 0,
    }),
  ),
});

export function createCompactMemoryTool(
  backend: MemoryBackend,
): ToolDefinition<typeof Parameters> {
  return {
    name: "compact_memory",
    label: "Compact Memory",
    description:
      "Find memory entries with values exceeding a character threshold. " +
      "Returns them for the agent to summarize and re-store via retain. " +
      "Helps keep memory concise and context-efficient.",
    promptSnippet: "Find oversized memory entries that should be summarized",
    promptGuidelines: [
      "Use compact_memory when you suspect memory values are growing too large and wasting ctx.",
      "compact_memory returns entries exceeding the threshold — summarize each and call retain with a concise version.",
      "compact_memory: aim for summaries under 2-3 sentences. The goal is context efficiency, not perfect preservation.",
      "compact_memory: skip entries that cannot be meaningfully shortened (e.g., exact commands, small code snippets).",
    ],
    parameters: Parameters,
    renderCall(args, theme, _ctx) {
      const threshold = args.threshold ?? DEFAULT_THRESHOLD;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("compact_memory"))}  ${theme.fg("muted", `threshold: ${threshold} chars`)}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme, ctx) {
      if (ctx.isError) {
        return renderError("Compaction check failed", theme);
      }

      const textContent = extractTextContent(result);

      if (!textContent) {
        return new Text(theme.fg("muted", "No compaction needed"), 0, 0);
      }

      return new Text(textContent, 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const threshold = params.threshold ?? DEFAULT_THRESHOLD;

      const entries = await backend.recall({
        cwd: ctx.cwd,
        options: { list: true },
      });

      const projectEntries = entries.filter((e) => e.scope === "project");
      const globalEntries = entries.filter((e) => e.scope === "global");

      const oversized = entries
        .filter((e) => e.value.length > threshold)
        .sort((a, b) => b.value.length - a.value.length);

      if (oversized.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `All ${entries.length} entries (${projectEntries.length} project, ${globalEntries.length} global) are within the ${threshold}-character threshold. No compaction needed.`,
            },
          ],
          details: {},
        };
      }

      const totalOversized = oversized.reduce(
        (sum, e) => sum + e.value.length,
        0,
      );
      const lines: string[] = [
        `${oversized.length} of ${entries.length} entries exceed the ${threshold}-character threshold (${totalOversized.toLocaleString()} total oversized chars).`,
        "",
        'For each entry below, summarize the value to 2-3 concise sentences, then call retain to store the compacted version. Use scope: "global" for entries labeled (global). Skip entries that cannot be meaningfully shortened.',
        "",
      ];

      for (const { key, value, scope } of oversized) {
        const label = scope === "global" ? " (global)" : "";
        lines.push(
          `## ${key}${label} (${value.length.toLocaleString()} chars)`,
          "```",
          value,
          "```",
          "",
        );
      }

      lines.push(
        "After compacting, you may want to call compact_memory again to verify all entries are within threshold.",
      );

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: {},
      };
    },
  };
}
