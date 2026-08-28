import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextContent } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharepointConfig } from "../src/config.js";
import { createLoadSharepointTool } from "../src/tools/load-sharepoint.js";

const CONFIG: SharepointConfig = {
  baseUrl: "https://graph.microsoft.com/v1.0",
  tokenSource: "env:PI_OFFICE_TEST_TOKEN",
};

let tmpDir: string;

beforeEach(() => {
  process.env.PI_OFFICE_TEST_TOKEN = "tok";
  // Assign the returned path — mkdtempSync appends a suffix to the prefix.
  tmpDir = mkdtempSync(join(tmpdir(), "pi-office-tool-test-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PI_OFFICE_TEST_TOKEN;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createLoadSharepointTool", () => {
  it("downloads a file and returns its local output path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "s" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "d" })))
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode("%PDF-bytes")),
      );
    const expectedBytes = new TextEncoder().encode("%PDF-bytes").length;
    vi.stubGlobal("fetch", fetchMock);

    const tool = createLoadSharepointTool(CONFIG);
    const result = await tool.execute(
      "call-1",
      { url: "https://contoso.sharepoint.com/sites/team/Docs/report.pdf" },
      undefined,
      undefined,
      {} as never,
    );

    const outputPath = result.details.outputPath;
    expect(outputPath).toMatch(/report\.pdf$/);
    expect(readFileSync(outputPath, "utf-8")).toBe("%PDF-bytes");
    expect(result.details.source).toContain("contoso.sharepoint.com");
    expect(result.details.bytes).toBe(expectedBytes);
    expect((result.content[0]! as TextContent).text).toContain(outputPath);
  });

  it("propagates client errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    const tool = createLoadSharepointTool(CONFIG);
    await expect(
      tool.execute(
        "call-1",
        { url: "https://contoso.sharepoint.com/sites/t/Docs/f.pdf" },
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow(/unauthorized/i);
  });
});
