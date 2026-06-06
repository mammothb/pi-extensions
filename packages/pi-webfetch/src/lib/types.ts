import { StringEnum } from "@earendil-works/pi-ai";
import type { Static } from "typebox";

export const FormatSchema = StringEnum(["text", "markdown", "html"] as const, {
  description:
    "The format to return the content in - text, markdown, or html (default: 'markdown')",
});
export type Format = Static<typeof FormatSchema>;

export type Header = Record<
  "User-Agent" | "Accept" | "Accept-Language",
  string
>;
