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
  return new Response(bytes as unknown as BodyInit, { status: 200 });
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
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:sites/team",
    );
    expect(siteCall[1].headers.Authorization).toBe("Bearer test-token-123");
    expect(driveCall[0]).toBe(
      "https://graph.microsoft.com/v1.0/sites/site-1/drive",
    );
    // Spaces in the item path must be encoded.
    expect(fetchMock.mock.calls[2][0]).toBe(
      "https://graph.microsoft.com/v1.0/drives/drive-1/root:/Shared%20Documents/a.pdf:/content",
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
      client.downloadFile("https://contoso.sharepoint.com/sites/t/f.pdf"),
    ).rejects.toThrow(/unauthorized.*expired or lack Files.Read/i);
  });

  it("throws on missing file (404)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "s" }))
      .mockResolvedValueOnce(jsonResponse({ id: "d" }))
      .mockResolvedValue(jsonResponse({}, 404));

    const client = new SharepointClient(CONFIG);
    await expect(
      client.downloadFile("https://contoso.sharepoint.com/sites/t/gone.pdf"),
    ).rejects.toThrow(/file not found/);
  });

  it("fails clearly when the token cannot be resolved", async () => {
    delete process.env.PI_OFFICE_TEST_TOKEN;
    const client = new SharepointClient(CONFIG);
    await expect(
      client.downloadFile("https://contoso.sharepoint.com/sites/t/f.pdf"),
    ).rejects.toThrow(/Failed to resolve SharePoint token/);
  });

  it("fails clearly when no tokenSource is configured", async () => {
    const client = new SharepointClient({
      baseUrl: CONFIG.baseUrl,
      tokenSource: "",
    });
    await expect(
      client.downloadFile("https://contoso.sharepoint.com/sites/t/f.pdf"),
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
    await client.downloadFile("https://contoso.sharepoint.com/sites/t/f.bin");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer cmd-token",
    );
  });
});
