import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isBashToolResult } from "@earendil-works/pi-coding-agent";
import { stripAnsiFast } from "./lib/ansi";

/**
 * Register a `tool_result` lifecycle hook that strips ANSI escape sequences
 * from bash tool output before it enters the session log.
 *
 * This keeps session logs permanently clean — no downstream post-processing
 * needed in compaction or recall.
 */
export function registerToolResultCleanup(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, _ctx) => {
    if (!isBashToolResult(event)) {
      return;
    }

    const content = event.content;
    const textItem = content?.find((c) => c.type === "text");
    if (!textItem || !("text" in textItem)) {
      return;
    }

    const originalText = textItem.text;
    const filteredText = stripAnsiFast(originalText);
    if (filteredText === originalText) {
      return;
    }

    return {
      content: content.map((c) =>
        c.type === "text" ? { ...c, text: filteredText } : c,
      ),
    };
  });
}
