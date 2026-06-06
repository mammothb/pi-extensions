import { Value } from "typebox/value";
import { McpResultPayload } from "./types";

/**
 * Try to parse a JSON object from a string, returning the first text content.
 */
function tryParsePayload(payload: string): string | undefined {
  const trimmed = payload.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const data = Value.Parse(McpResultPayload, JSON.parse(trimmed));
    return data.result.content.find((item) => item.text)?.text;
  } catch {
    return undefined;
  }
}

/** Parse an MCP response body, handling both plain JSON and SSE streams. */
export function parseResponse(body: string): string | undefined {
  const trimmed = body.trim();

  // Try direct JSON parse first
  if (trimmed) {
    const direct = tryParsePayload(trimmed);
    if (direct) {
      return direct;
    }
  }

  // Try SSE lines: "data: {...}"
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const data = tryParsePayload(line.slice(6));
    if (data) {
      return data;
    }
  }

  return undefined;
}
