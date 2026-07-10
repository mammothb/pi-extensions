import { describe, expect, it } from "vitest";
import type { WebsearchConfig } from "../../src/config";
import { createProvider } from "../../src/lib/providers";

const BASE_CONFIG: WebsearchConfig = {
  provider: "exa-mcp",
  exaMcp: {
    url: "https://mcp.exa.ai/mcp",
    tool: "web_search_exa",
  },
  searxng: {
    url: "http://localhost:8080",
    safesearch: 0,
  },
  timeoutMs: 25_000,
  defaults: {
    numResults: 8,
    type: "auto",
    livecrawl: "fallback",
    contextMaxCharacters: 10_000,
  },
};

describe("createProvider", () => {
  it('returns an exa-mcp provider when config.provider is "exa-mcp"', () => {
    const provider = createProvider(BASE_CONFIG);
    expect(provider.name).toBe("exa-mcp");
    expect(provider.usageNotes).toBeTruthy();
  });

  it('returns a searxng provider when config.provider is "searxng"', () => {
    const config: WebsearchConfig = {
      ...BASE_CONFIG,
      provider: "searxng",
    };
    const provider = createProvider(config);
    expect(provider.name).toBe("searxng");
    expect(provider.usageNotes).toBeTruthy();
  });

  it("throws for an unknown provider value", () => {
    const config = {
      ...BASE_CONFIG,
      provider: "unknown" as unknown as WebsearchConfig["provider"],
    };
    expect(() => createProvider(config)).toThrow("Unknown provider: unknown");
  });
});
