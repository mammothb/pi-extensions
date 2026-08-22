/**
 * Content capture helpers — hashing, truncation, and capture-mode gating.
 *
 * The default emit policy is metadata-only: a sha256 hash plus counts and
 * durations. Raw content is emitted only when the corresponding `capture.*`
 * flag is on, and is truncated to `summaryLength` before it hits a span.
 * Hashes are salted with nothing (plain sha256) so the same input hashes
 * identically across spans — that is what makes them correlatable and
 * dedupable without leaking content.
 */
import { createHash } from "node:crypto";

/** sha256 hex digest. Accepts a string or raw bytes. */
export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface Summary {
  /** Truncated text (maxLen chars + "…"), or the full text when short. */
  summary: string;
  /** sha256 hex digest of the *untruncated* input. */
  sha256: string;
  /** True when the input was longer than maxLen. */
  truncated: boolean;
}

/** Truncate `text` to `maxLen` chars with a "…" suffix; always emit the
 * hash of the full text. */
export function summarize(text: string, maxLen: number): Summary {
  const truncated = text.length > maxLen;
  const summary = truncated ? `${text.slice(0, maxLen)}…` : text;
  return { summary, sha256: sha256(text), truncated };
}

export type CaptureMode = "off" | "summary" | "full";

export interface CaptureResult {
  /** sha256 hex digest of `raw`. Always present. */
  sha256: string;
  /** Captured content. Absent when `mode` is `"off"`. Truncated to
   * `maxLen` when `mode` is `"summary"`; the raw text when `"full"`. */
  content?: string;
  /** True when `content` was truncated. */
  truncated?: boolean;
}

/** Apply a capture mode to raw text. `"off"` returns only the hash;
 * `"summary"` returns hash + truncated text; `"full"` returns hash + raw. */
export function applyCaptureMode(
  raw: string,
  mode: CaptureMode,
  maxLen: number,
): CaptureResult {
  const hash = sha256(raw);
  if (mode === "off") {
    return { sha256: hash };
  }
  if (mode === "full") {
    return { sha256: hash, content: raw, truncated: false };
  }
  const s = summarize(raw, maxLen);
  return { sha256: hash, content: s.summary, truncated: s.truncated };
}

/** Serialize an arbitrary value to a stable string for hashing/capture.
 * Strings pass through unchanged; everything else is JSON-serialized (with
 * a `String()` fallback for circular refs / BigInt). Deterministic for a
 * given input object. */
export function toContent(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    // Circular reference or other non-serializable value — `String()` on an
    // object would yield the useless "[object Object]", so fall back to a
    // type-tagged marker instead.
    return `[unserializable ${typeof value}]`;
  }
}
