import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  type EvalDetails,
  EvalToolError,
  type SubprocessResult,
} from "./types.js";

export const MAX_OUTPUT = 1024 * 1024; // 1 MB

export interface FormatOutputOptions {
  stdout: string;
  stderr: string;
  truncated?: boolean;
  exitSignal?: string | null;
}

export function formatOutput(opts: FormatOutputOptions): string {
  const parts: string[] = [];
  parts.push(`STDOUT:\n${opts.stdout || "(no output)"}`);
  if (opts.stderr) {
    parts.push(`STDERR:\n${opts.stderr}`);
  }
  if (opts.truncated) {
    parts.push("[Output truncated at 1 MB]");
  }
  if (opts.exitSignal) {
    parts.push(`[Process killed by signal: ${opts.exitSignal}]`);
  }
  return parts.join("\n\n");
}

/**
 * Convert a subprocess result into an AgentToolResult, throwing on failure.
 *
 * @throws {EvalToolError} if exitCode is non-zero or the process was killed by a signal.
 */
export function assertSuccessOrThrow(
  language: string,
  result: SubprocessResult,
): AgentToolResult<EvalDetails> {
  const output = formatOutput({
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
    exitSignal: result.exitSignal,
  });
  // Treat non-zero exit code or signal kill as failure
  if (result.exitCode !== 0 || result.exitSignal != null) {
    throw new EvalToolError(output, "NON_ZERO_EXIT");
  }
  return {
    content: [{ type: "text" as const, text: output }],
    details: {
      language,
      exitCode: result.exitCode,
      exitSignal: result.exitSignal,
    },
  };
}
