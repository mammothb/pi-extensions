import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { extractPreview } from "../src/preview";

function textBlock(text: string) {
  return { type: "text" as const, text };
}

function imgBlock() {
  return { type: "image" as const, data: "abc", mimeType: "image/png" };
}

function assistantMsg(text: string): AgentMessage {
  return {
    role: "assistant" as const,
    content: [textBlock(text)],
  } as unknown as AgentMessage;
}

function assistantMulti(
  ...parts: ReturnType<typeof textBlock | typeof imgBlock>[]
): AgentMessage {
  return {
    role: "assistant" as const,
    content: parts,
  } as unknown as AgentMessage;
}

function userMsg(text: string): AgentMessage {
  return {
    role: "user" as const,
    content: text,
  } as unknown as AgentMessage;
}

describe("extractPreview", () => {
  it('returns "(no assistant message)" for empty messages', () => {
    expect(extractPreview([])).toBe("(no assistant message)");
  });

  it('returns "(no assistant message)" when there are only user messages', () => {
    expect(extractPreview([userMsg("hello")])).toBe("(no assistant message)");
  });

  it('returns "(no text content)" when assistant has only image content', () => {
    expect(extractPreview([assistantMulti(imgBlock())])).toBe(
      "(no text content)",
    );
  });

  it("returns the full text for short messages", () => {
    expect(extractPreview([assistantMsg("hello world")])).toBe("hello world");
  });

  it("joins multiple text blocks with a space", () => {
    expect(
      extractPreview([assistantMulti(textBlock("hello"), textBlock("world"))]),
    ).toBe("hello world");
  });

  it("skips image blocks and joins text blocks", () => {
    expect(
      extractPreview([
        assistantMulti(textBlock("hello"), imgBlock(), textBlock("world")),
      ]),
    ).toBe("hello world");
  });

  it("truncates at 200 characters and appends ellipsis", () => {
    const long = "a".repeat(250);
    expect(extractPreview([assistantMsg(long)])).toBe(`${"a".repeat(200)}...`);
  });

  it("does not append ellipsis for exactly 200 characters", () => {
    const exact = "a".repeat(200);
    expect(extractPreview([assistantMsg(exact)])).toBe(exact);
  });

  it("picks the last assistant message when there are multiple", () => {
    expect(
      extractPreview([
        assistantMsg("first"),
        userMsg("interrupt"),
        assistantMsg("last"),
      ]),
    ).toBe("last");
  });

  it("picks the last assistant when assistants are interleaved with users", () => {
    expect(
      extractPreview([
        userMsg("start"),
        assistantMsg("first reply"),
        userMsg("follow-up"),
        assistantMsg("second reply"),
      ]),
    ).toBe("second reply");
  });
});
