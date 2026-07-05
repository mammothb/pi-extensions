import type { Message } from "@earendil-works/pi-ai";
import { clip, textOf } from "./content";
import { extractPath, summarizeToolArgs } from "./tool-args";

interface BashExecutionMessage {
  role: "bashExecution";
  command?: string;
  output?: string;
}

export interface RenderedEntry {
  index: number;
  role: string;
  summary: string;
  files?: string[];
}

const toolCalls = (content: Message["content"]): string => {
  if (!content || typeof content === "string") {
    return "";
  }
  return content
    .filter((c) => c.type === "toolCall")
    .map((c) => `${c.name}(${summarizeToolArgs(c.arguments)})`)
    .join(", ");
};

const extractFilesFromContent = (content: Message["content"]): string[] => {
  if (!content || typeof content === "string") {
    return [];
  }
  return content
    .filter((c) => c.type === "toolCall")
    .map((c) => extractPath(c.arguments))
    .filter((p): p is string => p !== null);
};

export const renderMessage = (
  msg: Message,
  index: number,
  full = false,
): RenderedEntry => {
  if (msg.role === "user") {
    return {
      index,
      role: "user",
      summary: full ? textOf(msg.content) : clip(textOf(msg.content), 300),
    };
  }
  if (msg.role === "toolResult") {
    const text = full ? textOf(msg.content) : clip(textOf(msg.content), 200);
    return {
      index,
      role: "tool_result",
      summary: `[${msg.toolName}] ${text}`,
    };
  }
  // bashExecution has command+output instead of content
  if ((msg.role as string) === "bashExecution") {
    const bash = msg as unknown as BashExecutionMessage;
    const cmd = bash.command ?? "";
    const out = bash.output ?? "";
    const text = full ? `$ ${cmd}\n${out}` : clip(`$ ${cmd}\n${out}`, 300);
    return { index, role: "bash", summary: text };
  }
  const text = full ? textOf(msg.content) : clip(textOf(msg.content), 300);
  const tools = toolCalls(msg.content);
  const files = extractFilesFromContent(msg.content);
  const summary = tools ? `${tools}\n${text}` : text;
  return {
    index,
    role: "assistant",
    summary,
    ...(files.length > 0 && { files }),
  };
};
