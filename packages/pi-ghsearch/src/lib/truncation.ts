import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "@earendil-works/pi-coding-agent";

export interface TruncationOutput {
  /** The text to send to the LLM (truncated content + notice, or full content). */
  text: string;
  /** Non-null if output was truncated. */
  truncation?: TruncationResult;
  /** Path to temp file containing the full untruncated output, if truncated. */
  fullOutputPath?: string;
}

/**
 * Apply truncation to tool output text.
 *
 * If the text exceeds DEFAULT_MAX_LINES or DEFAULT_MAX_BYTES, the head is kept
 * and the full output is written to a temp file so the agent can still access it
 * via `bash read`.
 *
 * @param fullText - The complete output text to potentially truncate.
 * @returns TruncationOutput with the (possibly truncated) text and metadata.
 */
export async function applyTruncation(
  fullText: string,
): Promise<TruncationOutput> {
  const truncation = truncateHead(fullText, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: truncation.content };
  }

  let text = truncation.content;
  text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
  text += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;

  let fullOutputPath: string | undefined;

  // Write full output to a temp file so the agent can read it
  try {
    const dir = await mkdtemp(join(tmpdir(), "pi-ghsearch-"));
    fullOutputPath = join(dir, "output");
    await writeFile(fullOutputPath, fullText, "utf-8");
    text += ` Full output saved to: ${fullOutputPath}`;
  } catch {
    // If temp file write fails, the truncated output is still usable
  }

  text += `]`;

  return { text, truncation, fullOutputPath };
}
