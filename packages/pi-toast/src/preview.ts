import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";

/**
 * Extract a 200-character preview from the last assistant message.
 *
 * Looks backward through the message list to find the most recent assistant
 * message, joins its text content, and truncates to 200 characters.
 * Returns descriptive strings for edge cases (no assistant, no text).
 */
export function extractPreview(messages: AgentMessage[]): string {
  const last = [...messages]
    .reverse()
    .find((m): m is AssistantMessage => m.role === "assistant");
  if (!last) {
    return "(no assistant message)";
  }

  const text = last.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join(" ");
  if (!text) {
    return "(no text content)";
  }

  const preview = text.slice(0, 200);
  return preview.length < text.length ? `${preview}...` : preview;
}
