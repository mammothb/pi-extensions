import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebsearchConfig } from "../src/config";
import {
  ALL_UNSLOTH_ENGINES,
  DEFAULT_CONFIG,
  loadConfig,
  resolveUnslothEngines,
} from "../src/config";

// We test loadConfig end-to-end using real temp directories to avoid
// mocking getAgentDir (which is complex and fragile).

let tmpDir: string;
let agentDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `pi-web-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`, // NOSONAR — not cryptographic, test fixture only
  );
  agentDir = join(tmpDir, "agent");
  projectDir = join(tmpDir, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(projectDir, ".pi"), { recursive: true });

  // Point getAgentDir to our temp directory
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeGlobal(config: Partial<WebsearchConfig>): void {
  writeFileSync(join(agentDir, "pi-web.json"), JSON.stringify(config, null, 2));
}

function writeProject(config: Partial<WebsearchConfig>): void {
  writeFileSync(
    join(projectDir, ".pi", "pi-web.json"),
    JSON.stringify(config, null, 2),
  );
}

describe("loadConfig", () => {
  it("returns defaults when no config files exist", () => {
    const config = loadConfig(projectDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("loads global config", () => {
    writeGlobal({ timeoutMs: 5000 });
    const config = loadConfig(projectDir);

    expect(config.timeoutMs).toBe(5000);
    // Other fields remain at defaults
    expect(config.provider).toBe(DEFAULT_CONFIG.provider);
    expect(config.exaMcp).toEqual(DEFAULT_CONFIG.exaMcp);
    expect(config.defaults).toEqual(DEFAULT_CONFIG.defaults);
  });

  it("loads project config", () => {
    writeProject({ timeoutMs: 10_000 });
    const config = loadConfig(projectDir);

    expect(config.timeoutMs).toBe(10_000);
  });

  it("project config overrides global config", () => {
    writeGlobal({ timeoutMs: 5000 });
    writeProject({ timeoutMs: 10_000 });

    const config = loadConfig(projectDir);
    expect(config.timeoutMs).toBe(10_000);
  });

  it("deep-merges exaMcp config", () => {
    writeGlobal({
      exaMcp: { url: "https://global.example.com/mcp", tool: "global_tool" },
      timeoutMs: 5000,
    });
    writeProject({
      exaMcp: { url: "https://project.example.com/mcp" },
    });

    const config = loadConfig(projectDir);

    // url overridden by project, tool inherited from global
    expect(config.exaMcp.url).toBe("https://project.example.com/mcp");
    expect(config.exaMcp.tool).toBe("global_tool");
    expect(config.timeoutMs).toBe(5000);
  });

  it("deep-merges searxng config", () => {
    writeGlobal({
      searxng: { url: "https://global-searxng.example.com", safesearch: 2 },
      timeoutMs: 5000,
    });
    writeProject({
      searxng: { url: "https://project-searxng.example.com" },
    });

    const config = loadConfig(projectDir);

    // url overridden by project, safesearch inherited from global
    expect(config.searxng.url).toBe("https://project-searxng.example.com");
    expect(config.searxng.safesearch).toBe(2);
    expect(config.timeoutMs).toBe(5000);
  });

  it("deep-merges defaults config", () => {
    writeGlobal({
      defaults: { numResults: 20, type: "deep" as const },
    });
    writeProject({
      defaults: { numResults: 5 },
    });

    const config = loadConfig(projectDir);

    expect(config.defaults.numResults).toBe(5); // project overrides
    expect(config.defaults.type).toBe("deep"); // inherited from global
    expect(config.defaults.livecrawl).toBe(DEFAULT_CONFIG.defaults.livecrawl);
    expect(config.defaults.contextMaxCharacters).toBe(
      DEFAULT_CONFIG.defaults.contextMaxCharacters,
    );
  });

  it("allows overriding all fields", () => {
    const custom: WebsearchConfig = {
      provider: "searxng",
      exaMcp: {
        url: "https://custom.example.com/mcp",
        tool: "custom_search_tool",
      },
      searxng: {
        url: "https://searxng.example.com",
        safesearch: 2,
      },
      timeoutMs: 60_000,
      defaults: {
        numResults: 20,
        type: "fast",
        livecrawl: "preferred",
        contextMaxCharacters: 5000,
      },
    };

    writeProject(custom);
    const config = loadConfig(projectDir);

    expect(config).toEqual(custom);
  });

  it("partial project config preserves global defaults for unspecified keys", () => {
    writeGlobal({
      exaMcp: { url: "https://global.example.com/mcp" },
      searxng: { safesearch: 2 },
      defaults: { numResults: 20 },
    });
    writeProject({ timeoutMs: 3000 });

    const config = loadConfig(projectDir);

    expect(config.timeoutMs).toBe(3000);
    expect(config.exaMcp.url).toBe("https://global.example.com/mcp");
    // tool from DEFAULT_CONFIG since global didn't specify it
    expect(config.exaMcp.tool).toBe(DEFAULT_CONFIG.exaMcp.tool);
    // searxng safesearch from global, url from default
    expect(config.searxng.safesearch).toBe(2);
    expect(config.searxng.url).toBe(DEFAULT_CONFIG.searxng.url);
    expect(config.defaults.numResults).toBe(20);
    expect(config.defaults.type).toBe(DEFAULT_CONFIG.defaults.type);
  });

  it("handles malformed global JSON gracefully (falls back)", () => {
    writeFileSync(join(agentDir, "pi-web.json"), "{ not json }");
    writeProject({ timeoutMs: 9999 });

    const config = loadConfig(projectDir);

    // Global parse failed, so we use defaults + project
    expect(config.timeoutMs).toBe(9999);
    expect(config.provider).toBe(DEFAULT_CONFIG.provider);
    expect(config.exaMcp).toEqual(DEFAULT_CONFIG.exaMcp);
  });

  it("handles malformed project JSON gracefully (falls back)", () => {
    writeGlobal({ timeoutMs: 5000 });
    writeFileSync(join(projectDir, ".pi", "pi-web.json"), "{ not json }");

    const config = loadConfig(projectDir);

    // Project parse failed, so we use global only
    expect(config.timeoutMs).toBe(5000);
    expect(config.provider).toBe(DEFAULT_CONFIG.provider);
  });

  it("preserves provider when not overridden", () => {
    writeProject({ timeoutMs: 42 });
    const config = loadConfig(projectDir);
    expect(config.provider).toBe("exa-mcp");
  });

  it("loads unsloth provider", () => {
    writeProject({ provider: "unsloth" });
    const config = loadConfig(projectDir);
    expect(config.provider).toBe("unsloth");
  });

  it("deep-merges unsloth config", () => {
    writeGlobal({
      unsloth: { region: "de-de", safesearch: "off" as const },
    });
    writeProject({
      unsloth: { timeoutMs: 8000 },
    });
    const config = loadConfig(projectDir);
    expect(config.unsloth?.region).toBe("de-de");
    expect(config.unsloth?.safesearch).toBe("off");
    expect(config.unsloth?.timeoutMs).toBe(8000);
  });
});

describe("resolveUnslothEngines", () => {
  it("returns all engines when cfg is undefined", () => {
    expect(resolveUnslothEngines(undefined)).toEqual([...ALL_UNSLOTH_ENGINES]);
    expect(resolveUnslothEngines(null as unknown as undefined)).toEqual([
      ...ALL_UNSLOTH_ENGINES,
    ]);
    expect(resolveUnslothEngines({})).toEqual([...ALL_UNSLOTH_ENGINES]);
  });

  it("allowlist filters to specified engines", () => {
    expect(resolveUnslothEngines({ engines: ["brave", "duckduckgo"] })).toEqual(
      ["brave", "duckduckgo"],
    );
  });

  it("blocklist removes disabled engines", () => {
    const result = resolveUnslothEngines({
      disabledEngines: ["yandex", "yahoo"],
    });
    expect(result).not.toContain("yandex");
    expect(result).not.toContain("yahoo");
    expect(result.length).toBe(ALL_UNSLOTH_ENGINES.length - 2);
  });

  it("throws when both engines and disabledEngines are set", () => {
    expect(() =>
      resolveUnslothEngines({
        engines: ["brave"],
        disabledEngines: ["yahoo"],
      }),
    ).toThrow(/mutually exclusive/);
  });

  it("throws on unknown engine id", () => {
    expect(() =>
      resolveUnslothEngines({ engines: ["bing" as unknown as "brave"] }),
    ).toThrow(/Unknown unsloth engine/);
    expect(() =>
      resolveUnslothEngines({
        disabledEngines: ["bing" as unknown as "brave"],
      }),
    ).toThrow(/Unknown unsloth engine/);
  });

  it("throws when resolved set is empty", () => {
    expect(() => resolveUnslothEngines({ engines: [] })).toThrow(
      /no engines enabled/,
    );
    expect(() =>
      resolveUnslothEngines({
        disabledEngines: [...ALL_UNSLOTH_ENGINES],
      }),
    ).toThrow(/no engines enabled/);
  });

  it("dedupes allowlist while preserving order", () => {
    expect(
      resolveUnslothEngines({ engines: ["brave", "brave", "google"] }),
    ).toEqual(["brave", "google"]);
  });

  it("throws when engines is not an array", () => {
    expect(() =>
      resolveUnslothEngines({
        engines: "brave" as unknown as ["brave"],
      }),
    ).toThrow(/must be an array/);
  });

  it("throws when disabledEngines is not an array", () => {
    expect(() =>
      resolveUnslothEngines({
        disabledEngines: "brave" as unknown as ["brave"],
      }),
    ).toThrow(/must be an array/);
  });
});
