import type { TextContent } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebfetchTool } from "../src/webfetch.js";
import { mockFetchOnce } from "./_helpers/fetch.js";

const HTML_BODY = "<h1>Hello World</h1><p>Some content.</p>";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

// ---------------------------------------------------------------------------
// Tool definition shape
// ---------------------------------------------------------------------------
describe("createWebfetchTool — tool definition shape", () => {
  const tool = createWebfetchTool();

  it('has name "webfetch"', () => {
    expect(tool.name).toBe("webfetch");
  });

  it("has label and promptSnippet", () => {
    expect(tool.label).toBeTruthy();
    expect(tool.promptSnippet).toBeTruthy();
  });

  it("description mentions markdown, URL, and format options", () => {
    expect(tool.description).toContain("markdown");
    expect(tool.description).toContain("URL");
    expect(tool.description).toContain("format");
  });

  describe("parameters", () => {
    const params = tool.parameters;

    it("has url (required, with https?:// pattern)", () => {
      expect(params.properties.url).toBeDefined();
      // TypeBox required check: url is in the required array
      expect(params.required).toContain("url");
      expect(Value.Check(params.properties.url, "https://example.com")).toBe(
        true,
      );
      expect(Value.Check(params.properties.url, "http://example.com")).toBe(
        true,
      );
      expect(Value.Check(params.properties.url, "ftp://example.com")).toBe(
        false,
      );
    });

    it("has format (optional, StringEnum)", () => {
      expect(params.properties.format).toBeDefined();
      expect(params.required).not.toContain("format");
      // Verify it's a StringEnum: anyOf with const values
      expect(Value.Check(params.properties.format, "text")).toBe(true);
      expect(Value.Check(params.properties.format, "markdown")).toBe(true);
      expect(Value.Check(params.properties.format, "html")).toBe(true);
      expect(Value.Check(params.properties.format, "json")).toBe(false);
    });

    it("has timeout (optional number, max 120)", () => {
      expect(params.properties.timeout).toBeDefined();
      expect(params.required).not.toContain("timeout");
      expect(Value.Check(params.properties.timeout, 1)).toBe(true);
      expect(Value.Check(params.properties.timeout, 120)).toBe(true);
      expect(Value.Check(params.properties.timeout, 0)).toBe(false);
      expect(Value.Check(params.properties.timeout, 121)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// execute — happy paths
// ---------------------------------------------------------------------------
describe("execute — happy paths", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches URL and returns markdown by default (format omitted)", async () => {
    mockFetchOnce({
      body: HTML_BODY,
      headers: { "content-type": HTML_CONTENT_TYPE },
    });

    const tool = createWebfetchTool();
    const result = await tool.execute(
      "id-1",
      { url: "https://example.com" },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect((result.content[0]! as TextContent).text).toContain("# Hello World");
    expect((result.content[0]! as TextContent).text).toContain("Some content");
    expect(result.details.format).toBe("markdown");
  });

  it('fetches URL and returns text when format: "text"', async () => {
    mockFetchOnce({
      body: HTML_BODY,
      headers: { "content-type": HTML_CONTENT_TYPE },
    });

    const tool = createWebfetchTool();
    const result = await tool.execute(
      "id-2",
      { url: "https://example.com", format: "text" },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect(result.details.format).toBe("text");
    expect(result.content[0]!.type).toBe("text");
    // toText strips tags
    expect((result.content[0]! as TextContent).text).toContain("Hello World");
    expect((result.content[0]! as TextContent).text).not.toContain("<h1>");
  });

  it('fetches URL and returns raw HTML when format: "html"', async () => {
    mockFetchOnce({
      body: HTML_BODY,
      headers: { "content-type": HTML_CONTENT_TYPE },
    });

    const tool = createWebfetchTool();
    const result = await tool.execute(
      "id-3",
      { url: "https://example.com", format: "html" },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect(result.details.format).toBe("html");
    expect(result.content[0]!.type).toBe("text");
    // Raw HTML is returned as-is
    expect((result.content[0]! as TextContent).text).toContain("<h1>");
  });

  it("sends correct Accept header per format", async () => {
    const mock = mockFetchOnce({
      body: HTML_BODY,
      headers: { "content-type": HTML_CONTENT_TYPE },
    });

    const tool = createWebfetchTool();
    await tool.execute(
      "id-4",
      { url: "https://example.com", format: "markdown" },
      undefined,
      vi.fn(),
      {} as any,
    );

    const fetchArgs = mock.mock.calls[0]!;
    const headers = fetchArgs[1]?.headers as Record<string, string>;
    expect(headers.Accept).toContain("text/markdown;q=1.0");
  });

  it("sends default browser-like Accept header when format is unknown", async () => {
    const mock = mockFetchOnce({
      body: HTML_BODY,
      headers: { "content-type": HTML_CONTENT_TYPE },
    });

    const tool = createWebfetchTool();
    await tool.execute(
      "id-5",
      // TypeScript would normally guard against this, but the runtime default
      // path exists in buildHeaders for safety.
      { url: "https://example.com", format: "unknown" as "markdown" },
      undefined,
      vi.fn(),
      {} as any,
    );

    const fetchArgs = mock.mock.calls[0]!;
    const headers = fetchArgs[1]?.headers as Record<string, string>;
    expect(headers.Accept).toContain("image/avif");
  });
});

// ---------------------------------------------------------------------------
// execute — error & edge cases
// ---------------------------------------------------------------------------
describe("execute — error & edge cases", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "Cancelled" when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const tool = createWebfetchTool();
    const result = await tool.execute(
      "id-cancel",
      { url: "https://example.com" },
      controller.signal,
      vi.fn(),
      {} as any,
    );

    expect(result.content).toHaveLength(1);
    expect((result.content[0]! as TextContent).text).toBe("Cancelled");
    expect(result.details.error).toBe(true);
  });

  it("throws on HTTP 404", async () => {
    mockFetchOnce({ status: 404, body: "Not Found" });

    const tool = createWebfetchTool();
    await expect(
      tool.execute(
        "id-404",
        { url: "https://example.com/notfound" },
        undefined,
        vi.fn(),
        {} as any,
      ),
    ).rejects.toThrow("HTTP 404");
  });

  it("throws on HTTP 500", async () => {
    mockFetchOnce({ status: 500, body: "Server Error" });

    const tool = createWebfetchTool();
    await expect(
      tool.execute(
        "id-500",
        { url: "https://example.com" },
        undefined,
        vi.fn(),
        {} as any,
      ),
    ).rejects.toThrow("HTTP 500");
  });

  it("default timeout is 30 seconds when not specified", async () => {
    vi.useFakeTimers();

    // Mock fetch that hangs (pends forever unless aborted)
    const mock = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) {
          onAbort();
        } else {
          init?.signal?.addEventListener("abort", onAbort, { once: true });
        }
      });
    });
    vi.stubGlobal("fetch", mock);

    const tool = createWebfetchTool();
    const promise = tool.execute(
      "id-timeout",
      { url: "https://example.com" },
      undefined,
      vi.fn(),
      {} as any,
    );

    // Advance just under 30 s → should still be pending
    vi.advanceTimersByTime(29_999);
    // Advance past 30 s → timeout fires
    vi.advanceTimersByTime(2);

    await expect(promise).rejects.toThrow("Request timed out");

    vi.useRealTimers();
  });

  it("timeout is capped at 120 seconds even if higher value passed", async () => {
    vi.useFakeTimers();

    const mock = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) {
          onAbort();
        } else {
          init?.signal?.addEventListener("abort", onAbort, { once: true });
        }
      });
    });
    vi.stubGlobal("fetch", mock);

    const tool = createWebfetchTool();
    const promise = tool.execute(
      "id-timeout",
      { url: "https://example.com", timeout: 999 },
      undefined,
      vi.fn(),
      {} as any,
    );

    // Should still be pending at 119 s
    vi.advanceTimersByTime(119_999);
    // Timeout fires at 120 s
    vi.advanceTimersByTime(2);

    await expect(promise).rejects.toThrow("Request timed out");

    vi.useRealTimers();
  });

  it("timeout converts seconds to milliseconds correctly", async () => {
    vi.useFakeTimers();

    const mock = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) {
          onAbort();
        } else {
          init?.signal?.addEventListener("abort", onAbort, { once: true });
        }
      });
    });
    vi.stubGlobal("fetch", mock);

    const tool = createWebfetchTool();
    const promise = tool.execute(
      "id-timeout",
      { url: "https://example.com", timeout: 2 },
      undefined,
      vi.fn(),
      {} as any,
    );

    // Should still be pending at 1999 ms
    vi.advanceTimersByTime(1999);
    // Timeout fires at 2000 ms
    vi.advanceTimersByTime(2);

    await expect(promise).rejects.toThrow("Request timed out");

    vi.useRealTimers();
  });

  it("throws when content-length exceeds 5 MB limit", async () => {
    mockFetchOnce({
      body: "small body",
      headers: { "content-length": String(5 * 1024 * 1024 + 1) },
    });

    const tool = createWebfetchTool();
    await expect(
      tool.execute(
        "id-size-hdr",
        { url: "https://example.com" },
        undefined,
        vi.fn(),
        {} as any,
      ),
    ).rejects.toThrow("Response too large");
  });

  it("throws when response body exceeds 5 MB (streaming, no content-length)", async () => {
    const largeBody = new Uint8Array(5 * 1024 * 1024 + 1);
    mockFetchOnce({ body: largeBody });

    const tool = createWebfetchTool();
    await expect(
      tool.execute(
        "id-size-body",
        { url: "https://example.com" },
        undefined,
        vi.fn(),
        {} as any,
      ),
    ).rejects.toThrow("Response too large");
  });

  it("cleans up timeout after successful fetch (no late abort)", async () => {
    vi.useFakeTimers();

    mockFetchOnce({
      body: "<p>fast</p>",
      headers: { "content-type": HTML_CONTENT_TYPE },
    });

    const tool = createWebfetchTool();
    const result = await tool.execute(
      "id-cleanup",
      { url: "https://example.com", timeout: 1 },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect((result.content[0]! as TextContent).text).toContain("fast");

    // Advance timers way past the 1 s timeout — should not throw
    vi.advanceTimersByTime(5000);

    vi.useRealTimers();
  });

  it("removes abort event listener in finally block", async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    mockFetchOnce({
      body: "<p>test</p>",
      headers: { "content-type": HTML_CONTENT_TYPE },
    });

    const tool = createWebfetchTool();
    await tool.execute(
      "id-listener",
      { url: "https://example.com" },
      controller.signal,
      vi.fn(),
      {} as any,
    );

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

// ---------------------------------------------------------------------------
// Cloudflare retry
// ---------------------------------------------------------------------------
describe("Cloudflare retry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retries with "opencode" User-Agent when cf-mitigated: challenge header present', async () => {
    // First call: 403 with cf-mitigated → triggers retry
    // Second call: 200 with content
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("blocked", {
          status: 403,
          headers: new Headers({
            "cf-mitigated": "challenge",
            "content-type": "text/html",
          }),
        }),
      )
      .mockResolvedValueOnce(
        new Response("<p>ok</p>", {
          status: 200,
          headers: new Headers({ "content-type": "text/html" }),
        }),
      );
    vi.stubGlobal("fetch", mock);

    const tool = createWebfetchTool();
    const result = await tool.execute(
      "id-cf",
      { url: "https://example.com" },
      undefined,
      vi.fn(),
      {} as any,
    );

    // Should have succeeded on retry
    expect((result.content[0]! as TextContent).text).toContain("ok");

    // First call: default UA (Chrome)
    const firstCallHeaders = mock.mock.calls[0]![1]!.headers as Record<
      string,
      string
    >;
    expect(firstCallHeaders["User-Agent"]).toContain("Chrome");

    // Second call: retry UA ("opencode")
    const secondCallHeaders = mock.mock.calls[1]![1]!.headers as Record<
      string,
      string
    >;
    expect(secondCallHeaders["User-Agent"]).toBe("opencode");

    // Exactly two fetch calls
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on non-CF 403 (no cf-mitigated header)", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("forbidden", {
          status: 403,
          headers: new Headers({ "content-type": "text/plain" }),
        }),
      )
      .mockResolvedValue(
        new Response("should not be reached", { status: 200 }),
      );
    vi.stubGlobal("fetch", mock);

    const tool = createWebfetchTool();
    await expect(
      tool.execute(
        "id-no-cf",
        { url: "https://example.com" },
        undefined,
        vi.fn(),
        {} as any,
      ),
    ).rejects.toThrow("HTTP 403");

    // Only one fetch call — no retry
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("only retries once (does not infinite loop)", async () => {
    // Both calls return CF challenge → second one should throw
    const mock = vi.fn().mockResolvedValue(
      new Response("blocked", {
        status: 403,
        headers: new Headers({
          "cf-mitigated": "challenge",
          "content-type": "text/html",
        }),
      }),
    );
    vi.stubGlobal("fetch", mock);

    const tool = createWebfetchTool();
    await expect(
      tool.execute(
        "id-loop",
        { url: "https://example.com" },
        undefined,
        vi.fn(),
        {} as any,
      ),
    ).rejects.toThrow("HTTP 403");

    // Should have retried exactly once (2 total calls)
    expect(mock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Image detection
// ---------------------------------------------------------------------------
describe("image detection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];

  for (const mime of imageTypes) {
    it(`${mime} → treated as image, returns base64 content`, async () => {
      const imageBytes = new Uint8Array([0x01, 0x02, 0x03]);
      mockFetchOnce({
        body: imageBytes,
        headers: { "content-type": mime },
      });

      const tool = createWebfetchTool();
      const result = await tool.execute(
        "id-img",
        { url: `https://example.com/photo.${mime.split("/")[1]}` },
        undefined,
        vi.fn(),
        {} as any,
      );

      expect(result.details.isImage).toBe(true);

      // Should have a text + image content item
      const textContent = result.content.find((c) => c.type === "text") as any;
      const imageContent = result.content.find(
        (c) => c.type === "image",
      ) as any;

      expect(textContent).toBeDefined();
      expect(textContent.text).toContain("Image fetched successfully");
      expect(textContent.text).toContain(mime);

      expect(imageContent).toBeDefined();
      expect(imageContent.type).toBe("image");
      expect(imageContent.data).toBe(
        Buffer.from(imageBytes).toString("base64"),
      );
      expect(imageContent.mimeType).toBe(mime);
    });
  }

  it("image/svg+xml → NOT treated as image (treated as text/XML)", async () => {
    const svg = "<svg><circle/></svg>";
    mockFetchOnce({
      body: svg,
      headers: { "content-type": "image/svg+xml" },
    });

    const tool = createWebfetchTool();
    const result = await tool.execute(
      "id-svg",
      { url: "https://example.com/image.svg" },
      undefined,
      vi.fn(),
      {} as any,
    );

    expect(result.details.isImage).toBeFalsy();
    // Should have been treated as text content
    expect(result.content[0]!.type).toBe("text");
    expect((result.content[0]! as TextContent).text).toContain("<svg>");
  });
});
