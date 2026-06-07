import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import { setGlobalMemoryAndTTL, setMemoryAndTTL } from "./lib/store.js";

const Parameters = Type.Object({
  observation: Type.String({
    description: "The observation or learning to store",
  }),
  key: Type.Optional(
    Type.String({
      description:
        "Key to store under. Auto-generated as reflection-{timestamp} if omitted.",
    }),
  ),
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

export function createReflectTool(
  baseDir?: string,
): ToolDefinition<typeof Parameters> {
  return {
    name: "reflect",
    label: "Reflect",
    description:
      "Store a conversation observation or learning in persistent memory. " +
      "Auto-generates a timestamp-prefixed key if none is provided. " +
      'Use scope: "global" to share across all projects. ' +
      "Use ttlSeconds for temporary observations.",
    promptSnippet: "Store a conversation reflection in persistent memory",
    promptGuidelines: [
      "Use reflect to capture learnings from the current conversation — conventions discovered, user preferences observed, or mistakes to avoid.",
      "If you know a good descriptive key, provide it with a namespace prefix (e.g. 'convention:error-handling', 'user:prefers-tabs'). Otherwise leave key empty for an auto-generated timestamp key.",
      "Reflections are stored in the same memory as retain and can be found with recall. Use namespace: 'reflection-' to find all reflection entries.",
      'Use scope: "global" for observations that apply across all projects (e.g. coding style preferences).',
      "Use ttlSeconds for time-sensitive observations that will become stale (e.g. 'this dependency is on version X' when it may be updated soon).",
      "Keep values concise (under 2000 chars). Use compact_memory to find and summarize oversized entries.",
    ],
    parameters: Parameters,
    renderCall(args, theme, _context) {
      const parts: string[] = [theme.fg("toolTitle", theme.bold("reflect"))];
      const keyPreview = args.key
        ? args.key.length > 40
          ? `${args.key.slice(0, 40)}…`
          : args.key
        : theme.fg("muted", "timestamp");
      parts.push(theme.fg("syntaxKeyword", keyPreview));
      if (args.scope === "global") {
        parts.push(theme.fg("muted", "(global)"));
      }
      if (args.ttlSeconds != null) {
        parts.push(theme.fg("muted", `(ttl:${args.ttlSeconds}s)`));
      }
      return new Text(parts.join(" "), 0, 0);
    },
    renderResult(_result, _options, theme, context) {
      if (context.isError) {
        return renderError("Failed to reflect", theme);
      }
      return new Text(theme.fg("success", "Reflected"), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { observation, key, scope, ttlSeconds } = params;

      if (!observation.trim()) {
        return {
          content: [
            { type: "text", text: "Error: observation must not be empty" },
          ],
          details: {},
        };
      }

      const effectiveKey = key?.trim()
        ? key.trim()
        : `reflection-${new Date().toISOString()}`;

      const ttlNote = ttlSeconds != null ? ` (expires in ${ttlSeconds}s)` : "";

      if (scope === "global") {
        setGlobalMemoryAndTTL(effectiveKey, observation, ttlSeconds, baseDir);
        return {
          content: [
            {
              type: "text",
              text: `Reflected as "${effectiveKey}" (global)${ttlNote}`,
            },
          ],
          details: {},
        };
      }

      setMemoryAndTTL(ctx.cwd, effectiveKey, observation, ttlSeconds, baseDir);
      return {
        content: [
          { type: "text", text: `Reflected as "${effectiveKey}"${ttlNote}` },
        ],
        details: {},
      };
    },
  };
}
