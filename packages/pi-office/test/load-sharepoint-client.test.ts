import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharepointConfig } from "../src/config.js";
import { SharepointClient } from "../src/sharepoint.js";

const CONFIG: SharepointConfig = {
  baseUrl: "https://graph.microsoft.com/v1.0",
  tokenSource: "env:PI_OFFICE_TEST_TOKEN",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.PI_OFFICE_TEST_TOKEN = "test-token-123";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PI_OFFICE_TEST_TOKEN;
});

describe("SharepointClient", () => {
  it("resolves site and drive once, then downloads with one request per file", async () => {
    fetchMock
      // site lookup
      .mockResolvedValueOnce(jsonResponse({ id: "site-1" }))
      // drive lookup
      .mockResolvedValueOnce(jsonResponse({ id: "drive-1" }))
      // two downloads
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("pdf")))
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("docx")));

    const client = new SharepointClient(CONFIG);
    const url =
      "https://contoso.sharepoint.com/sites/team/Shared Documents/a.pdf";

    const first = await client.downloadFile(url);
    expect(first.fileName).toBe("a.pdf");
    expect(first.bytes.toString()).toBe("pdf");

    await client.downloadFile(
      "https://contoso.sharepoint.com/sites/team/Shared Documents/b.docx",
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [siteCall, driveCall] = fetchMock.mock.calls;
    expect(siteCall[0]).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/team",
    );
    expect(siteCall[1].headers.Authorization).toBe("Bearer test-token-123");
    expect(driveCall[0]).toBe(
      "https://graph.microsoft.com/v1.0/sites/site-1/drive",
    );
    // The parser drops the document-library segment (e.g. "Shared Documents")
    // because the resolved default drive's root already maps to that library.
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://graph.microsoft.com/v1.0/drives/drive-1/root:/a.pdf:/content",
    );
  });

  it("builds the personal-site reference with a slash after the colon", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "ps" }))
      .mockResolvedValueOnce(jsonResponse({ id: "pd" }))
      .mockResolvedValueOnce(bytesResponse(new Uint8Array([1])));

    const client = new SharepointClient(CONFIG);
    await client.downloadFile(
      "https://contoso-my.sharepoint.com/personal/alice/Documents/notes.docx",
    );

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso-my.sharepoint.com:/personal/alice",
    );
  });

  it("uses the root-site flow when the URL has no /sites/ segment", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "root-site" }))
      .mockResolvedValueOnce(jsonResponse({ id: "drive-root" }))
      .mockResolvedValueOnce(bytesResponse(new Uint8Array([1, 2, 3])));

    const client = new SharepointClient(CONFIG);
    const result = await client.downloadFile(
      "https://contoso.sharepoint.com/Shared Documents/file.xlsx",
    );

    expect(result.fileName).toBe("file.xlsx");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com",
    );
  });

  it("throws a helpful error on 401", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 401));
    const client = new SharepointClient(CONFIG);
    await expect(
      client.downloadFile("https://contoso.sharepoint.com/sites/t/Docs/f.pdf"),
    ).rejects.toThrow(/unauthorized.*expired or lack Files.Read/i);
  });

  it("throws on missing file (404)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "d" }))
      .mockResolvedValue(jsonResponse({}, 404));

    const client = new SharepointClient(CONFIG);
    await expect(
      client.downloadFile(
        "https://contoso.sharepoint.com/sites/t/Docs/gone.pdf",
      ),
    ).rejects.toThrow(/file not found/);
  });

  it("fails clearly when the token cannot be resolved", async () => {
    delete process.env.PI_OFFICE_TEST_TOKEN;
    const client = new SharepointClient(CONFIG);
    await expect(
      client.downloadFile("https://contoso.sharepoint.com/sites/t/Docs/f.pdf"),
    ).rejects.toThrow(/Failed to resolve SharePoint token/);
  });

  it("fails clearly when no tokenSource is configured", async () => {
    const client = new SharepointClient({
      baseUrl: CONFIG.baseUrl,
      tokenSource: "",
    });
    await expect(
      client.downloadFile("https://contoso.sharepoint.com/sites/t/Docs/f.pdf"),
    ).rejects.toThrow(/not configured/);
  });

  it("supports cmd: token sources", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "d" }))
      .mockResolvedValueOnce(bytesResponse(new Uint8Array([9])));

    const client = new SharepointClient({
      ...CONFIG,
      tokenSource: "cmd:echo cmd-token",
    });
    await client.downloadFile(
      "https://contoso.sharepoint.com/sites/t/Docs/f.bin",
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer cmd-token",
    );
  });

  it("resolves editor URLs via the shares endpoint", async () => {
    const rawUrl =
      "https://contoso.sharepoint.com/sites/team/_layouts/15/Doc.aspx?sourcedoc=%7BGUID%7D&file=report.docx&action=edit";
    // The parser strips everything but the sourcedoc param before the shares
    // endpoint resolves the link, so the token is built from the stripped URL.
    const parsedUrl =
      "https://contoso.sharepoint.com/sites/team/_layouts/15/Doc.aspx?sourcedoc=%7BGUID%7D";
    const expectedToken = `u!${Buffer.from(parsedUrl, "utf-8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\//g, "_")
      .replace(/\+/g, "-")}`;

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: "report.docx", file: {} }))
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode("docx")));

    const client = new SharepointClient(CONFIG);
    const result = await client.downloadFile(rawUrl);

    expect(result.fileName).toBe("report.docx");
    expect(result.bytes.toString()).toBe("docx");
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://graph.microsoft.com/v1.0/shares/${expectedToken}/driveItem`,
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      `https://graph.microsoft.com/v1.0/shares/${expectedToken}/driveItem/content`,
    );
  });

  it("resolves opaque share links via the shares endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: "budget.xlsx" }))
      .mockResolvedValueOnce(bytesResponse(new Uint8Array([1])));

    const client = new SharepointClient(CONFIG);
    const result = await client.downloadFile(
      "https://contoso.sharepoint.com/:x:/s/sites/team/EYz8mNtoken",
    );
    expect(result.fileName).toBe("budget.xlsx");
  });

  it("rejects shared links that point at folders", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ name: "Team Docs", folder: {} }),
    );

    const client = new SharepointClient(CONFIG);
    await expect(
      client.downloadFile(
        "https://contoso.sharepoint.com/sites/team/_layouts/15/Doc.aspx?sourcedoc={FOLDER}",
      ),
    ).rejects.toThrow(/folder.*not a file/);
  });

  it("aborts before issuing any request when the caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const client = new SharepointClient(CONFIG);
    await expect(
      client.downloadFile(
        "https://contoso.sharepoint.com/sites/t/Docs/f.pdf",
        controller.signal,
      ),
    ).rejects.toThrow(/Cancelled/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a combined caller+timeout signal to fetch", async () => {
    const controller = new AbortController();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "d" }))
      .mockResolvedValueOnce(bytesResponse(new Uint8Array([1])));

    const client = new SharepointClient(CONFIG);
    await client.downloadFile(
      "https://contoso.sharepoint.com/sites/t/Docs/f.pdf",
      controller.signal,
    );

    // Every call must carry an AbortSignal (the combination), not the raw one.
    for (const call of fetchMock.mock.calls) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
      expect(call[1].signal).not.toBe(controller.signal);
      expect(call[1].signal.aborted).toBe(false);
    }
  });

  it("rejects promptly when the connection stalls and the caller aborts", async () => {
    // Real fetch + real sockets: a mocked fetch bypasses undici's signal
    // handling, which is exactly what this test exercises.
    vi.unstubAllGlobals();

    // Server accepts the connection but never responds.
    const server: Server = createServer(() => {});
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as { port: number };

    try {
      const client = new SharepointClient({
        baseUrl: `http://127.0.0.1:${port}/v1.0`,
        tokenSource: "env:PI_OFFICE_TEST_TOKEN",
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);

      const start = Date.now();
      await expect(
        client.downloadFile(
          "https://contoso.sharepoint.com/sites/t/Docs/stalled.pdf",
          controller.signal,
        ),
      ).rejects.toThrow();
      // Must reject via caller signal, not the 60s timeout fallback.
      expect(Date.now() - start).toBeLessThan(5_000);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15_000);
});
