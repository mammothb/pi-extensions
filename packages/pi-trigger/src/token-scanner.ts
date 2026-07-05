import type { ScanResult, TriggerToken } from "./types.js";

// Matches #skill:name or #prompt:name
// Token must be at position 0 or preceded by whitespace
const TRIGGER_PATTERN = /#(skill|prompt):([A-Za-z0-9._-]+)/g;

/**
 * Scan input text for #skill:name and #prompt:name tokens.
 * Only matches tokens at position 0 or preceded by whitespace
 * (prevents false positives like /foo/skill:bar or http://prompt:x).
 */
export function scanTokens(text: string): ScanResult {
  const tokens: TriggerToken[] = [];

  for (const match of text.matchAll(TRIGGER_PATTERN)) {
    const start = match.index ?? 0;
    // Gate: token must be at position 0 or preceded by whitespace
    if (start !== 0 && !/\s/.test(text[start - 1] ?? "")) {
      continue;
    }

    const namespace = match[1] as "skill" | "prompt";
    const name = match[2];
    if (!name) {
      continue;
    }

    tokens.push({
      namespace,
      name,
      raw: match[0],
      start,
      end: start + match[0].length,
    });
  }

  return { tokens };
}

/**
 * Strip all matched trigger tokens from text, preserving surrounding whitespace.
 * Returns cleaned text with collapsed whitespace.
 */
export function stripTokens(text: string, tokens: TriggerToken[]): string {
  if (tokens.length === 0) {
    return text;
  }

  // Sort by start index descending to remove from right to left
  const sorted = [...tokens].sort((a, b) => b.start - a.start);

  let result = text;
  for (const token of sorted) {
    result = result.slice(0, token.start) + result.slice(token.end);
  }

  // Collapse multiple whitespace
  return result.replace(/\s+/g, " ").trim();
}
