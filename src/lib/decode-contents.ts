/**
 * Decode the base64-encoded content field from a GitHub Contents API response.
 *
 * GitHub's Contents API returns file content as:
 * ```json
 * { "content": "SGVsbG8g\nV29ybGQ=\n", "encoding": "base64", ... }
 * ```
 * The base64 string contains embedded newlines every 60 characters (MIME wrapping).
 *
 * @param parsed - Parsed JSON from a gh api response. May be any shape.
 * @returns The decoded UTF-8 string, or null if the response is not a Contents API response.
 */
export function decodeGitHubContent(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.encoding !== "base64" || typeof obj.content !== "string") {
    return null;
  }

  // GitHub inserts \n every 60 characters; strip them before decoding
  const cleaned = obj.content.replace(/\n/g, "");
  return Buffer.from(cleaned, "base64").toString("utf-8");
}
