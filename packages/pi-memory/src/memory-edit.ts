import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderError } from "@mammothb/pi-shared";
import { Type } from "typebox";
import {
  loadMemoryMeta,
  loadMemoryRaw,
  saveMemory,
  saveMemoryMeta,
} from "./lib/store.js";

const Parameters = Type.Object({
  action: Type.Union([Type.Literal("delete"), Type.Literal("rename")]),
  key: Type.String({ description: "Key to edit" }),
  newKey: Type.Optional(
    Type.String({ description: "New key name (required for rename)" }),
  ),
});

export function createMemoryEditTool(
  baseDir?: string,
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

      const memory = loadMemoryRaw(ctx.cwd, baseDir);

      switch (action) {
        case "delete": {
          if (!(key in memory)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Key "${key}" not found — nothing deleted.`,
                },
              ],
              details: {},
            };
          }
          delete memory[key];
          saveMemory(ctx.cwd, memory, baseDir);
          // Clean up any TTL metadata
          const meta = loadMemoryMeta(ctx.cwd, baseDir);
          if (key in meta) {
            delete meta[key];
            saveMemoryMeta(ctx.cwd, meta, baseDir);
          }
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
          if (!(key in memory)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Key "${key}" not found — nothing renamed.`,
                },
              ],
              details: {},
            };
          }
          // key existence was checked above
          // biome-ignore lint/style/noNonNullAssertion: guarded by `key in memory` check above
          const value = memory[key]!;
          delete memory[key];
          memory[newKey] = value;
          saveMemory(ctx.cwd, memory, baseDir);
          // Move any TTL metadata to the new key
          const meta = loadMemoryMeta(ctx.cwd, baseDir);
          if (key in meta) {
            const ttlEntry = meta[key];
            if (ttlEntry) {
              meta[newKey] = ttlEntry;
            }
            delete meta[key];
            saveMemoryMeta(ctx.cwd, meta, baseDir);
          }
          return {
            content: [{ type: "text", text: `Renamed "${key}" → "${newKey}"` }],
            details: {},
          };
        }
      }
    },
  };
}
