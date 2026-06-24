import { describe, expect, it } from "vitest";

import { injectPrompt, loadPrompt } from "../src/prompt.js";

describe("prompt", () => {
  it("loadPrompt returns non-empty string", () => {
    const prompt = loadPrompt();
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("\u00b6PATH#TAG");
    expect(prompt).toContain('"old_range"');
    expect(prompt).toContain('"new_lines"');
    expect(prompt).toContain('"path"');
  });

  it("loadPrompt is cached (same reference on second call)", () => {
    const p1 = loadPrompt();
    const p2 = loadPrompt();
    expect(p1).toBe(p2);
  });

  it("injects prompt into system message", () => {
    const messages: unknown[] = [
      {
        role: "system",
        content: "You are a coding assistant.",
      },
    ];

    injectPrompt(messages);

    const systemMsg = messages[0] as { role?: string; content?: string };
    expect(systemMsg.content).toContain("You are a coding assistant.");
    expect(systemMsg.content).toContain("Hashline Edit Grammar");
    expect(systemMsg.content).toContain("¶PATH#TAG");
  });

  it("replaces marker if present", () => {
    const messages: unknown[] = [
      {
        role: "system",
        content:
          "You are a coding assistant.\n\n<!-- HASHLINE_GRAMMAR -->\n\nUse tools carefully.",
      },
    ];

    injectPrompt(messages);

    const systemMsg = messages[0] as { role?: string; content?: string };
    expect(systemMsg.content).toContain("You are a coding assistant.");
    expect(systemMsg.content).toContain("Hashline Edit Grammar");
    expect(systemMsg.content).toContain("Use tools carefully.");
    expect(systemMsg.content).not.toContain("<!-- HASHLINE_GRAMMAR -->");
  });

  it("no-ops on empty messages array", () => {
    const messages: unknown[] = [];
    injectPrompt(messages);
    expect(messages).toHaveLength(0);
  });

  it("skips if first message is not system role", () => {
    const messages: unknown[] = [
      {
        role: "user",
        content: "hello",
      },
    ];

    injectPrompt(messages);

    const msg = messages[0] as { role?: string; content?: string };
    expect(msg.content).not.toContain("Hashline Edit Grammar");
  });
});
