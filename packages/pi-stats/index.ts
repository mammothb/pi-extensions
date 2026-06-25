import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  InputEvent,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getExtNameFromPath } from "./src/path-util.js";
import { formatStats } from "./src/report.js";
import { StatsTracker } from "./src/tracker.js";

export default function (pi: ExtensionAPI) {
  const toolExt = new Map<string, string>();
  const cmdExt = new Map<string, string>();

  function getSessionId(ctx: ExtensionContext): string | undefined {
    try {
      const file = ctx.sessionManager.getSessionFile();
      return file ? path.basename(file) : undefined;
    } catch {
      return undefined;
    }
  }

  function refreshMaps() {
    try {
      toolExt.clear();
      for (const tool of pi.getAllTools()) {
        const src = tool.sourceInfo?.source;
        if (src && src !== "builtin" && src !== "sdk") {
          const ext = getExtNameFromPath(tool.sourceInfo?.path) ?? src;
          toolExt.set(tool.name, ext);
        }
      }
    } catch {
      // ignore
    }
    try {
      cmdExt.clear();
      for (const cmd of pi.getCommands()) {
        if (cmd.source === "extension") {
          const ext = getExtNameFromPath(cmd.sourceInfo?.path);
          if (ext) {
            cmdExt.set(cmd.name, ext);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  pi.on("session_start", async () => {
    refreshMaps();
  });

  pi.on("resources_discover", async () => {
    refreshMaps();
  });

  const tracker = new StatsTracker();

  // ── track extension tool calls ────────────────────────────────────────

  pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext) => {
    const ext = toolExt.get(event.toolName);
    if (ext) {
      tracker.recordExtension(ext, "tool", getSessionId(ctx));
    }
  });

  // ── track extension slash commands ────────────────────────────────────

  pi.on("input", (event: InputEvent, ctx: ExtensionContext) => {
    const text = event.text ?? "";
    const match = text.match(/^\/(\S+)/);
    const cmd = match?.[1];
    if (!cmd) {
      return;
    }
    const ext = cmdExt.get(cmd);
    if (ext) {
      tracker.recordExtension(ext, "ext-cmd", getSessionId(ctx));
    }
  });

  // ── /stats command ────────────────────────────────────────────────────

  pi.registerCommand("stats", {
    description: "Show extension usage stats",
    handler: async (_args, ctx) => {
      refreshMaps();
      const report = formatStats(tracker.getStats());
      ctx.ui.notify(report, "info");
    },
  });

  // ── stats tool (LLM-callable) ─────────────────────────────────────────

  pi.registerTool({
    name: "stats",
    label: "Usage Stats",
    description: "Get extension usage counts for the current session",
    promptSnippet: "Get extension usage counts",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: formatStats(tracker.getStats()) }],
        details: tracker.getStats(),
      };
    },
  });
}
