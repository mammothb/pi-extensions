import { afterEach, describe, expect, it, vi } from "vitest";
import { createExaMcpProvider } from "../../src/lib/providers/exa-mcp";
import { mockFetch } from "../_helpers/fetch";

const EXA_MCP_CONFIG = {
  url: "https://mcp.exa.ai/mcp",
  tool: "web_search_exa",
  timeoutMs: 5000,
};

const searchArgs = { query: "test", type: "auto" as const, numResults: 8 };

afterEach(() => {
  vi.unstubAllGlobals();
});

function validPayload(text: string): string {
  return JSON.stringify({
    result: { content: [{ type: "text", text }] },
  });
}

// ---------------------------------------------------------------------------
// buildMcpRequest (tested indirectly by inspecting the fetch call)
// ---------------------------------------------------------------------------

describe("buildMcpRequest (via fetch)", () => {
  it("sends correct JSON-RPC 2.0 shape", async () => {
    const fetchMock = mockFetch({ body: validPayload("ok") });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    await provider.search(searchArgs);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: EXA_MCP_CONFIG.tool,
      },
    });
    expect(body.params.arguments).toEqual(searchArgs);
  });

  it("filters out undefined values from arguments", async () => {
    const fetchMock = mockFetch({ body: validPayload("ok") });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    await provider.search({
      query: "test",
      type: undefined,
      numResults: undefined,
      livecrawl: undefined,
      contextMaxCharacters: undefined,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.params.arguments).toEqual({ query: "test" });
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("search", () => {
  it("resolves to parsed text on success (plain JSON)", async () => {
    mockFetch({ body: validPayload("hello world") });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBe("hello world");
  });

  it("resolves to parsed text on success (SSE)", async () => {
    const sseBody = `data: ${validPayload("from sse")}`;
    mockFetch({ body: sseBody });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    const result = await provider.search(searchArgs);
    expect(result).toBe("from sse");
  });

  it("throws on HTTP error (non-2xx)", async () => {
    mockFetch({ status: 500, statusText: "Internal Server Error" });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    await expect(provider.search(searchArgs)).rejects.toThrow(
      "Exa MCP returned HTTP 500: Internal Server Error",
    );
  });

  it("throws 'Request timed out' when the timeout fires", async () => {
    mockFetch({ neverResolves: true });
    const provider = createExaMcpProvider({ ...EXA_MCP_CONFIG, timeoutMs: 10 });

    await expect(provider.search(searchArgs)).rejects.toThrow(
      "Request timed out",
    );
  });

  it("throws 'Request aborted' for an already-aborted external signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    await expect(
      provider.search(searchArgs, controller.signal),
    ).rejects.toThrow("Request aborted");
  });

  it("propagates error when external signal aborts during fetch", async () => {
    const controller = new AbortController();
    mockFetch({ neverResolves: true });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    const resultPromise = provider.search(searchArgs, controller.signal);

    // Abort after a tick to simulate mid-flight abort
    await vi.waitFor(() => {
      controller.abort();
      return true;
    });

    await expect(resultPromise).rejects.toThrow("The operation was aborted.");
  });

  it("propagates network error (fetch rejects)", async () => {
    const error = new Error("Connection refused");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

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

    mockFetch({ body: validPayload("ok") });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);
    await provider.search(searchArgs, controller.signal);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );

    clearTimeoutSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it("sends correct URL, method and headers", async () => {
    const fetchMock = mockFetch({ body: validPayload("ok") });
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);

    await provider.search(searchArgs);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(EXA_MCP_CONFIG.url);
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
    });
  });

  it('has name "exa-mcp"', () => {
    const provider = createExaMcpProvider(EXA_MCP_CONFIG);
    expect(provider.name).toBe("exa-mcp");
  });
});
