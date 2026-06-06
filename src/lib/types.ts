import type { TruncationResult } from "@earendil-works/pi-coding-agent";

/** Fields shared by all pi-ghsearch tool details. */
export interface BaseToolDetails {
  /** The full gh CLI command that was executed. */
  command: string[];
  /** gh CLI exit code. */
  exitCode: number;
  /** stderr output (trimmed), if any. */
  stderr?: string;
}

export interface GhSearchDetails extends BaseToolDetails {
  /** Parsed JSON output, or undefined for non-JSON (e.g. code search). */
  parsed: unknown;
  /** Non-null if the output was truncated. */
  truncation?: TruncationResult;
  /** Path to file containing the full (untruncated) output. */
  fullOutputPath?: string;
}

export interface GhFetchDetails extends BaseToolDetails {
  /** Parsed JSON response, or undefined for non-JSON output. */
  parsed: unknown;
  /** Non-null if the output was truncated. */
  truncation?: TruncationResult;
  /** Path to file containing the full (untruncated) output. */
  fullOutputPath?: string;
  /** The API endpoint derived from the URL. */
  endpoint: string;
}

export interface GhAuthStatusDetails extends BaseToolDetails {
  /** Whether gh auth status exited with code 0. */
  authenticated: boolean;
}
