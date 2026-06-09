import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: vi.fn(),
}));

import { getAgentDir } from "@earendil-works/pi-coding-agent";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-ghsearch-test-"));
    vi.mocked(getAgentDir).mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function writeJson(relPath: string, data: unknown): void {
    const fullPath = join(tmpDir, relPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, JSON.stringify(data), "utf-8");
  }

  it("returns defaults when no config files exist", () => {
    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("global config overrides defaults", () => {
    writeJson("pi-ghsearch.json", {
      timeoutMs: 60_000,
      defaults: { limit: 10 },
    });

    const config = loadConfig(tmpDir);
    expect(config.timeoutMs).toBe(60_000);
    expect(config.defaults.limit).toBe(10);
    expect(config.organization).toBeUndefined();
  });

  it("project config overrides global", () => {
    writeJson("pi-ghsearch.json", {
      timeoutMs: 60_000,
      defaults: { limit: 10 },
    });

    writeJson(".pi/pi-ghsearch.json", {
      timeoutMs: 90_000,
      organization: "acme",
    });

    const config = loadConfig(tmpDir);
    expect(config.timeoutMs).toBe(90_000); // project overrides
    expect(config.organization).toBe("acme"); // project adds
    expect(config.defaults.limit).toBe(10); // global survives (not overridden)
  });

  it("malformed JSON is handled gracefully", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Write malformed JSON to project config
    const projectPath = join(tmpDir, ".pi", "pi-ghsearch.json");
    mkdirSync(join(projectPath, ".."), { recursive: true });
    writeFileSync(projectPath, "not json {{{", "utf-8");

    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG); // falls back to defaults
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse config"),
    );
  });

  it("missing optional keys don't crash", () => {
    writeJson("pi-ghsearch.json", { organization: "my-org" });

    const config = loadConfig(tmpDir);
    expect(config.organization).toBe("my-org");
    // Everything else is from defaults
    expect(config.timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
    expect(config.defaults).toEqual(DEFAULT_CONFIG.defaults);
  });

  it("empty JSON file doesn't crash", () => {
    writeJson("pi-ghsearch.json", {});

    const config = loadConfig(tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("organization is applied as a string", () => {
    writeJson("pi-ghsearch.json", {
      organization: "acme-corp",
    });

    const config = loadConfig(tmpDir);
    expect(config.organization).toBe("acme-corp");
  });

  it("banBashGh defaults to undefined (no blocking)", () => {
    const config = loadConfig(tmpDir);
    expect(config.banBashGh).toBeUndefined();
  });

  it("banBashGh true from global config", () => {
    writeJson("pi-ghsearch.json", { banBashGh: true });

    const config = loadConfig(tmpDir);
    expect(config.banBashGh).toBe(true);
  });

  it("banBashGh false overrides true from global", () => {
    writeJson("pi-ghsearch.json", { banBashGh: true });
    writeJson(".pi/pi-ghsearch.json", { banBashGh: false });

    const config = loadConfig(tmpDir);
    expect(config.banBashGh).toBe(false);
  });

  it("banBashGh ignores non-boolean values", () => {
    writeJson("pi-ghsearch.json", { banBashGh: "yes" });

    const config = loadConfig(tmpDir);
    expect(config.banBashGh).toBeUndefined(); // not a boolean, ignored
  });
});
