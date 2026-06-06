import { describe, expect, it } from "vitest";
import { parseResponse } from "../src/lib/parsers";

describe("parseResponse", () => {
  it("parses valid direct JSON and returns first text content", () => {
    const body = JSON.stringify({
      result: {
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(parseResponse(body)).toBe("hello");
  });

  it("parses valid SSE stream and returns text content", () => {
    const body = `data: ${JSON.stringify({
      result: {
        content: [{ type: "text", text: "world" }],
      },
    })}`;
    expect(parseResponse(body)).toBe("world");
  });

  it("returns text from first valid SSE data line when multiple are present", () => {
    const first = JSON.stringify({
      result: {
        content: [{ type: "text", text: "first" }],
      },
    });
    const second = JSON.stringify({
      result: {
        content: [{ type: "text", text: "second" }],
      },
    });
    const body = `data: ${first}\ndata: ${second}`;
    expect(parseResponse(body)).toBe("first");
  });

  it("returns undefined for empty body", () => {
    expect(parseResponse("")).toBeUndefined();
  });

  it("returns undefined for non-JSON string", () => {
    expect(parseResponse("not json")).toBeUndefined();
  });

  it("returns undefined for JSON that does not match McpResultPayload schema", () => {
    // Missing `result.content`
    const body = JSON.stringify({ foo: "bar" });
    expect(parseResponse(body)).toBeUndefined();
  });

  it("returns undefined for valid JSON with no text-typed content item", () => {
    // content item missing the required `text` field, so schema validation fails
    const body = JSON.stringify({
      result: {
        content: [{ type: "image" }],
      },
    });
    expect(parseResponse(body)).toBeUndefined();
  });

  it("returns undefined for valid JSON with empty content array", () => {
    const body = JSON.stringify({
      result: {
        content: [],
      },
    });
    expect(parseResponse(body)).toBeUndefined();
  });

  it("handles SSE line with extra whitespace after colon", () => {
    const payload = JSON.stringify({
      result: {
        content: [{ type: "text", text: "works" }],
      },
    });
    const body = `data:  ${payload}`;
    expect(parseResponse(body)).toBe("works");
  });

  it("parses only SSE data: lines in a multi-line body mixing plain text and SSE", () => {
    const payload = JSON.stringify({
      result: {
        content: [{ type: "text", text: "sse-result" }],
      },
    });
    const body = `some random text\ndata: ${payload}\nmore text`;
    expect(parseResponse(body)).toBe("sse-result");
  });

  it("picks first content item where text is defined when multiple items exist", () => {
    const body = JSON.stringify({
      result: {
        content: [
          { type: "text", text: "first-text" },
          { type: "text", text: "second-text" },
        ],
      },
    });
    expect(parseResponse(body)).toBe("first-text");
  });

  it("skips an SSE data line with non-JSON content and tries the next line", () => {
    const valid = JSON.stringify({
      result: { content: [{ type: "text", text: "valid" }] },
    });
    const body = `data: not-json-at-all\ndata: ${valid}`;
    expect(parseResponse(body)).toBe("valid");
  });
});
