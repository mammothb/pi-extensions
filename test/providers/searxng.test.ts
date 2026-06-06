import { afterEach, describe, expect, it, vi } from "vitest";
import { createSearxngProvider } from "../../src/lib/providers/searxng";
import { mockFetch } from "../_helpers/fetch";

const SEARXNG_CONFIG = {
  url: "http://localhost:8888",
  safesearch: 1 as const,
  timeoutMs: 5000,
};

const searchArgs = {
  query: "test",
  type: "auto" as const,
  numResults: 8,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function searchResponse(
  results: Array<{ title?: string; url?: string; content?: string }>,
) {
  return JSON.stringify({ results });
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("search", () => {
  it("returns formatted results on success", async () => {
    mockFetch({
      body: searchResponse([
        { title: "Result 1", url: "https://a.com", content: "Content A" },
        { title: "Result 2", url: "https://b.com", content: "Content B" },
      ]),
    });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBe(
      "## **1.** Result 1\n**URL:** https://a.com\nContent A\n\n---\n\n## **2.** Result 2\n**URL:** https://b.com\nContent B",
    );
  });

  it("uses 'Untitled' for results with no title", async () => {
    mockFetch({
      body: searchResponse([{ url: "https://a.com", content: "Body" }]),
    });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toContain("Untitled");
  });

  it("handles null title and content gracefully", async () => {
    mockFetch({
      body: JSON.stringify({
        results: [{ title: null, url: "https://a.com", content: null }],
      }),
    });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBe("## **1.** Untitled\n**URL:** https://a.com\n");
  });

  it("returns undefined when all results lack a URL", async () => {
    mockFetch({
      body: searchResponse([{ title: "No URL", content: "Body" }]),
    });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBeUndefined();
  });

  it("returns undefined when results array is empty", async () => {
    mockFetch({ body: searchResponse([]) });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBeUndefined();
  });

  it("returns undefined when response has no results field", async () => {
    mockFetch({ body: JSON.stringify({}) });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBeUndefined();
  });

  it("returns undefined when results field is null", async () => {
    mockFetch({ body: JSON.stringify({ results: null }) });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBeUndefined();
  });

  it("respects numResults to limit output", async () => {
    const results = Array.from({ length: 10 }, (_, i) => ({
      title: `R${i}`,
      url: `https://example.com/${i}`,
      content: `Content ${i}`,
    }));
    mockFetch({ body: searchResponse(results) });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const result = await provider.search({ ...searchArgs, numResults: 3 });
    // Should have exactly 3 results
    const count = (result ?? "").split("## **").length - 1;
    expect(count).toBe(3);
  });

  it("sends correct URL, parameters, and headers", async () => {
    const fetchMock = mockFetch({ body: searchResponse([]) });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    await provider.search(searchArgs);

    const [url] = fetchMock.mock.calls[0]! as [string];
    expect(url).toContain("/search?");
    expect(url).toContain("q=test");
    expect(url).toContain("format=json");
    expect(url).toContain("safesearch=1");
  });

  it("throws on HTTP error (non-2xx)", async () => {
    mockFetch({ status: 502, statusText: "Bad Gateway" });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    await expect(provider.search(searchArgs)).rejects.toThrow(
      "SearXNG returned HTTP 502: Bad Gateway",
    );
  });

  it("throws 'Request timed out' when the timeout fires", async () => {
    mockFetch({ neverResolves: true });
    const provider = createSearxngProvider({
      ...SEARXNG_CONFIG,
      timeoutMs: 10,
    });

    await expect(provider.search(searchArgs)).rejects.toThrow(
      "Request timed out",
    );
  });

  it("throws 'Request aborted' for an already-aborted external signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    await expect(
      provider.search(searchArgs, controller.signal),
    ).rejects.toThrow("Request aborted");
  });

  it("propagates error when external signal aborts during fetch", async () => {
    const controller = new AbortController();
    mockFetch({ neverResolves: true });
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    const resultPromise = provider.search(searchArgs, controller.signal);

    await vi.waitFor(() => {
      controller.abort();
      return true;
    });

    await expect(resultPromise).rejects.toThrow("The operation was aborted.");
  });

  it("propagates network error (fetch rejects)", async () => {
    const error = new Error("Connection refused");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    const provider = createSearxngProvider(SEARXNG_CONFIG);

    await expect(provider.search(searchArgs)).rejects.toThrow(
      "Connection refused",
    );
  });

  it("cleans up timeout and event listeners on success", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const controller = new AbortController();
    const removeEventListenerSpy = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );

    mockFetch({ body: searchResponse([{ url: "https://a.com" }]) });
    const provider = createSearxngProvider(SEARXNG_CONFIG);
    await provider.search(searchArgs, controller.signal);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );

    clearTimeoutSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it('has name "searxng"', () => {
    const provider = createSearxngProvider(SEARXNG_CONFIG);
    expect(provider.name).toBe("searxng");
  });
});
