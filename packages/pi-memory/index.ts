import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCompactMemoryTool } from "./src/compact-memory.js";
import { FileSystemBackend } from "./src/lib/backends/filesystem.js";
import { createMemoryEditTool } from "./src/memory-edit.js";
import { createRecallTool } from "./src/recall.js";
import { createReflectTool } from "./src/reflect.js";
import { createRetainTool } from "./src/retain.js";

const REFLECTION_INSTRUCTION = [
  "## Memory Reflection",
  "After discovering project conventions, user preferences, or build system details, call `reflect` to store them in persistent memory. These will be available across sessions via `recall`.",
  "",
  "Key moments to reflect:",
  "- When you learn a new convention, command, or pattern",
  "- When the user explicitly teaches you a preference",
  "- When you make a mistake and learn the correct approach",
  "- After completing a significant task or decision",
].join("\n");

export default function (pi: ExtensionAPI) {
  const backend = new FileSystemBackend({
    baseDir: path.join(os.homedir(), ".pi", "agent"),
  });

  pi.registerTool(createRetainTool(backend));
  pi.registerTool(createRecallTool(backend));
  pi.registerTool(createReflectTool(backend));
  pi.registerTool(createMemoryEditTool(backend));
  pi.registerTool(createCompactMemoryTool(backend));

  pi.on("session_start", async (_event, ctx) => {
    await backend.upsertIndex(ctx.cwd, {
      path: ctx.cwd,
      lastAccess: new Date().toISOString(),
    });
  });

  pi.on("before_agent_start", (_event, _ctx) => {
    return {
      systemPrompt: `${_event.systemPrompt}\n\n${REFLECTION_INSTRUCTION}`,
    };
  });
}
