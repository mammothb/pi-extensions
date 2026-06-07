import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export function isTextContent(c: TextContent | ImageContent): c is TextContent {
  return c.type === "text";
}
