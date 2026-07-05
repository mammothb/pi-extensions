import { readFileSync } from "node:fs";
import type { Message } from "@earendil-works/pi-ai";
import { type RenderedEntry, renderMessage } from "./render-entries";

export interface LoadedMessages {
  rendered: RenderedEntry[];
  rawMessages: Message[];
}

export const loadAllMessages = (
  sessionFile: string,
  full: boolean,
  allowedEntryIds?: Set<string>,
): LoadedMessages => {
  const content = readFileSync(sessionFile, "utf-8");
  const entries: Array<{ type?: unknown; id?: unknown; message?: unknown }> =
    [];
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  const rendered: RenderedEntry[] = [];
  const rawMessages: Message[] = [];

  let messageIndex = 0;
  for (const e of entries) {
    const isMessage = e.type === "message" && e.message;
    if (!isMessage) {
      continue;
    }

    const allowed = !allowedEntryIds || allowedEntryIds.has(e.id as string);
    if (allowed) {
      rendered.push(renderMessage(e.message as Message, messageIndex, full));
      rawMessages.push(e.message as Message);
    }
    messageIndex++;
  }

  return { rendered, rawMessages };
};
