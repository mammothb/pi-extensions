/**
 * Prompt injection for hashline — loads the LLM-facing grammar reference
 * and injects it into the system prompt before each agent turn.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Prompt loading ──────────────────────────────────────────────────

let _cachedPrompt: string | undefined;
let _cachedPath: string | undefined;

function getPromptPath(): string {
  if (_cachedPath === undefined) {
    _cachedPath = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");
  }
  return _cachedPath;
}

/** Load the hashline grammar prompt (cached after first read). */
export function loadPrompt(): string {
  if (_cachedPrompt === undefined) {
    _cachedPrompt = readFileSync(getPromptPath(), "utf-8");
  }
  return _cachedPrompt;
}

// ─── Injection helpers ───────────────────────────────────────────────

const PROMPT_MARKER = "<!-- HASHLINE_GRAMMAR -->";

/**
 * Inject the hashline grammar prompt into the system message.
 * Appends after the marker if present, otherwise appends to the end.
 */
export function injectPrompt(messages: unknown[]): void {
  const prompt = loadPrompt();
  if (messages.length === 0) {
    return;
  }

  // Find the system message (first message with role "system").
  const systemMsg = messages[0] as { role?: string; content?: string };
  if (
    systemMsg !== null &&
    typeof systemMsg === "object" &&
    systemMsg.role === "system" &&
    typeof systemMsg.content === "string"
  ) {
    // If there's a marker, replace it. Otherwise append.
    if (systemMsg.content.includes(PROMPT_MARKER)) {
      systemMsg.content = systemMsg.content.replace(PROMPT_MARKER, prompt);
    } else {
      systemMsg.content += `\n\n${prompt}`;
    }
  }
}
