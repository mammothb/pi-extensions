import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import { expandPrompt, expandSkill } from "./expander.js";
import { scanTokens } from "./token-scanner.js";
import type { TriggerDefinition } from "./types.js";

type TriggerStore = {
  skills: Map<string, TriggerDefinition>;
  prompts: Map<string, TriggerDefinition>;
};

/**
 * Handle the "input" event. Scans for /skill:name and /prompt:name tokens
 * anywhere in the text, expands them, sends custom messages, and returns
 * transformed text with tokens and their args stripped.
 */
export function createInputHandler(store: TriggerStore) {
  return async (event: InputEvent, _ctx: unknown, pi: ExtensionAPI) => {
    if (event.source === "extension") {
      return;
    }

    const { tokens } = scanTokens(event.text);
    if (tokens.length === 0) {
      return;
    }

    // Build removal ranges: each token's start → end, plus args for prompts
    const removals: Array<{ start: number; end: number }> = [];

    const expansions: Array<{
      namespace: string;
      name: string;
      location: string;
      content: string;
      block: string;
    }> = [];

    for (const token of tokens) {
      let def: TriggerDefinition | undefined;

      if (token.namespace === "skill") {
        def = store.skills.get(token.name);
        if (!def) {
          continue;
        }
        const result = expandSkill(def);
        expansions.push({
          namespace: "skill",
          name: token.name,
          location: def.filePath,
          content: result.content,
          block: result.block,
        });
        removals.push({ start: token.start, end: token.end });
      } else if (token.namespace === "prompt") {
        def = store.prompts.get(token.name);
        if (!def) {
          continue;
        }

        // Find the args region: from token.end to next token.start or end of text
        const nextRemoval = [...tokens]
          .filter((t) => t.start > token.end)
          .sort((a, b) => a.start - b.start)[0];
        const argsEnd = nextRemoval ? nextRemoval.start : event.text.length;
        const argsText = event.text.slice(token.end, argsEnd);
        const argsTrimmed = argsText.trim();

        const result = expandPrompt(def, argsTrimmed || undefined);
        expansions.push({
          namespace: "prompt",
          name: token.name,
          location: def.filePath,
          content: result.content,
          block: result.block,
        });

        // Remove token + trailing args (up to next token or end)
        removals.push({ start: token.start, end: argsEnd });
      }
    }

    if (expansions.length === 0) {
      return;
    }

    // Send custom message with all expanded triggers
    pi.sendMessage(
      {
        customType: "trigger",
        content: expansions.map((e) => e.block).join("\n\n"),
        display: true,
        details: { triggers: expansions },
      },
      {
        deliverAs:
          (event.streamingBehavior as "steer" | "followUp") ?? undefined,
      },
    );

    // Rebuild text by skipping removal ranges
    const cleanedText = stripRanges(event.text, removals);

    // If nothing remains after stripping, mark as handled
    // (custom messages were already sent above)
    if (!cleanedText) {
      return { action: "handled" as const };
    }

    return { action: "transform" as const, text: cleanedText };
  };
}

/** Remove disjoint ranges from text, collapsing whitespace. */
function stripRanges(
  text: string,
  ranges: Array<{ start: number; end: number }>,
): string {
  // Sort by start, merge overlapping/adjacent
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];

  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  let out = "";
  let cursor = 0;
  for (const r of merged) {
    out += text.slice(cursor, r.start);
    cursor = r.end;
  }
  out += text.slice(cursor);

  return out.replace(/\s+/g, " ").trim();
}
