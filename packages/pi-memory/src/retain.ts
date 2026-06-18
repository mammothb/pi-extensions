import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import type { MemoryBackend } from "./lib/backend.js";

const Parameters = Type.Object({
  key: Type.String({ description: "Key to store the value under" }),
  value: Type.String({ description: "Value to store" }),
  scope: Type.Optional(
    Type.Union([Type.Literal("project"), Type.Literal("global")], {
      description:
        'Scope for this entry. "project" (default) stores per-project; "global" stores across all projects.',
    }),
  ),
  ttlSeconds: Type.Optional(
    Type.Number({
      description:
        "Time-to-live in seconds. After this duration, the entry expires and is excluded from recall. Omit for permanent entries.",
      exclusiveMinimum: 0,
    }),
  ),
});

export function createRetainTool(
  backend: MemoryBackend,
): ToolDefinition<typeof Parameters> {
  return {
    name: "retain",
    label: "Retain",
    description:
      "Store a key-value pair in persistent memory for future recall. " +
      'Use scope: "global" to share across all projects. ' +
      "Use ttlSeconds for temporary entries that should auto-expire.",
    promptSnippet: "Store a key-value pair in persistent memory",
    promptGuidelines: [
      "Use retain to remember project conventions, user preferences, build commands, and other durable facts.",
      "retain: use descriptive, consistent key names with namespace prefixes so recall can filter them: 'project:', 'user:', 'convention:'.",
      "retain: overwrite a key by calling retain with the same key name.",
      'retain: use scope "global" for preferences that apply across all projects. Default scope is "project".',
      "retain: use ttlSeconds for observations that may become stale.",
      "Keep retained values concise (under 2000 chars). Use compact_memory to find oversized entries.",
    ],
    parameters: Parameters,
    renderCall(args, theme, _ctx) {
      const parts: string[] = [theme.fg("toolTitle", theme.bold("retain"))];
      const keyPreview =
        args.key.length > 50 ? `${args.key.slice(0, 50)}…` : args.key;
      parts.push(theme.fg("syntaxKeyword", keyPreview));
      if (args.scope === "global") {
        parts.push(theme.fg("muted", "(global)"));
      }
      if (args.ttlSeconds != null) {
        parts.push(theme.fg("muted", `(ttl:${args.ttlSeconds}s)`));
      }
      return new Text(parts.join(" "), 0, 0);
    },
    renderResult(_result, _options, theme, ctx) {
      if (ctx.isError) {
        return renderError("Failed to retain", theme);
      }
      return new Text(theme.fg("success", "Retained"), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { key, value, scope, ttlSeconds } = params;

      if (!key.trim()) {
        return {
          content: [{ type: "text", text: "Error: key must not be empty" }],
          details: {},
        };
      }

      const effectiveScope = scope ?? "project";
      const ttlNote = ttlSeconds != null ? ` (expires in ${ttlSeconds}s)` : "";

      await backend.retain({
        scope: effectiveScope,
        cwd: ctx.cwd,
        key,
        value,
        ttlSeconds,
      });

      const scopeLabel = effectiveScope === "global" ? " (global)" : "";
      return {
        content: [
          { type: "text", text: `Retained "${key}"${scopeLabel}${ttlNote}` },
        ],
        details: {},
      };
    },
  };
}
