import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { isTextContent } from "./is-text-content.js";

/** Join all text blocks from a tool result into a single string. */
export function extractTextContent(result: AgentToolResult<unknown>): string {
  return result.content
    .filter(isTextContent)
    .map((c) => c.text)
    .join("\n");
}

/** Get the first text block from a tool result, or empty string. */
export function firstTextBlock(result: AgentToolResult<unknown>): string {
  const block = result.content[0];
  return block?.type === "text" ? block.text : "";
}
