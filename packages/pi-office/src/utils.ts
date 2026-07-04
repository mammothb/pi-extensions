import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { expandTilde } from "@mammothb/pi-shared";

const DEFAULT_PREVIEW_CHARS = 2000;

/**
 * Resolve a file path, expanding ~ to the user's home directory.
 * Used for all file path arguments received from the LLM.
 */
export function resolvePath(rawPath: string): string {
  return expandTilde(rawPath);
}

/**
 * Create a temporary directory for tool output files.
 * Returns the absolute path to the new directory.
 */
export async function createTempDir(): Promise<string> {
  const prefix = join(tmpdir(), "pi-office-");
  return mkdtemp(prefix);
}

/**
 * Write content to a file inside a temp directory.
 * Returns the absolute path to the created file.
 */
export async function writeOutput(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filePath = join(dir, filename);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

/**
 * Return the first `maxChars` characters of text.
 * Appends "…" if the text was truncated.
 */
export function truncatePreview(
  text: string,
  maxChars: number = DEFAULT_PREVIEW_CHARS,
): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

/**
 * Build a standard AgentToolResult with a text preview and details.
 * The `details` object typically includes outputPath, stats, and format.
 */
export function buildToolResponse<T extends Record<string, unknown>>(
  preview: string,
  details: T,
): AgentToolResult<T> {
  return {
    content: [{ type: "text", text: preview }],
    details,
  };
}
