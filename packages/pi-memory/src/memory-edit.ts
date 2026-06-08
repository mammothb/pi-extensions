import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import type { MemoryBackend } from "./lib/backend.js";

const Parameters = Type.Object({
  action: Type.Union([Type.Literal("delete"), Type.Literal("rename")]),
  key: Type.String({ description: "Key to edit" }),
  newKey: Type.Optional(
    Type.String({ description: "New key name (required for rename)" }),
  ),
});

export function createMemoryEditTool(
  backend: MemoryBackend,
): ToolDefinition<typeof Parameters> {
  return {
    name: "memory_edit",
    label: "Memory Edit",
    description:
      "Edit persistent memory entries — delete a key or rename a key. " +
      "To update a key's value, use retain with the same key name instead.",
    promptSnippet: "Delete or rename a persistent memory entry",
    promptGuidelines: [
      "Use memory_edit to clean up stale or incorrect memory entries.",
      "To update a value, use retain instead — it overwrites the existing key.",
      "Deleting a key is permanent (the value is removed from disk).",
    ],
    parameters: Parameters,
    renderCall(args, theme, _context) {
      const action = theme.fg("syntaxKeyword", args.action);
      const keyPreview =
        args.key.length > 40 ? `${args.key.slice(0, 40)}…` : args.key;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("memory_edit"))}  ${action}  ${theme.fg("toolOutput", keyPreview)}`,
        0,
        0,
      );
    },
    renderResult(_result, _options, theme, context) {
      if (context.isError) {
        return renderError("Edit failed", theme);
      }
      return new Text(theme.fg("success", "Done"), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, key, newKey } = params;

      switch (action) {
        case "delete": {
          await backend.forget({
            scope: "project",
            cwd: ctx.cwd,
            key,
          });
          return {
            content: [{ type: "text", text: `Deleted "${key}"` }],
            details: {},
          };
        }
        case "rename": {
          if (!newKey) {
            return {
              content: [
                {
                  type: "text",
                  text: 'Error: "newKey" is required for rename action.',
                },
              ],
              details: {},
            };
          }
          if (newKey === key) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: newKey is the same as key ("${key}") — nothing renamed.`,
                },
              ],
              details: {},
            };
          }
          await backend.rename({
            scope: "project",
            cwd: ctx.cwd,
            oldKey: key,
            newKey,
          });
          return {
            content: [{ type: "text", text: `Renamed "${key}" → "${newKey}"` }],
            details: {},
          };
        }
      }
    },
  };
}
