/**
 * Strip ANSI escape sequences from text.
 * Handles standard CSI sequences, OSC sequences, and other escapes.
 *
 * Adapted from pi-rtk-debunked/techniques/ansi.ts
 */
export function stripAnsi(text: string): string {
  return (
    text
      // Standard ANSI escape sequences (CSI)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: looking for ansi escape sequences
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      // OSC sequences (e.g., terminal title, hyperlinks)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: looking for ansi escape sequences
      .replace(/\x1b\][0-9;]*(?:\x07|\x1b\\)/g, "")
      // Other escape sequences
      // biome-ignore lint/suspicious/noControlCharactersInRegex: looking for ansi escape sequences
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
  );
}

/** Fast path: only runs regex if text contains an escape character. */
export function stripAnsiFast(text: string): string {
  if (!text.includes("\x1b")) {
    return text;
  }
  return stripAnsi(text);
}
