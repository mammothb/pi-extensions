import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCompactMemoryTool } from "./src/compact-memory.js";
import { hashCwd, loadIndex, saveIndex } from "./src/lib/store.js";
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
  pi.registerTool(createRetainTool());
  pi.registerTool(createRecallTool());
  pi.registerTool(createReflectTool());
  pi.registerTool(createMemoryEditTool());
  pi.registerTool(createCompactMemoryTool());

  pi.on("session_start", (_event, ctx) => {
    // Update the project registry so index.json tracks known projects
    const index = loadIndex();
    const hash = hashCwd(ctx.cwd);
    index[hash] = {
      path: ctx.cwd,
      lastAccess: new Date().toISOString(),
    };
    saveIndex(index);
  });

  pi.on("before_agent_start", (_event, _ctx) => {
    return {
      systemPrompt: `${_event.systemPrompt}\n\n${REFLECTION_INSTRUCTION}`,
    };
  });
}
