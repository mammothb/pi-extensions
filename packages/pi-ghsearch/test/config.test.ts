import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pi-ghsearch-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function writeJson(relPath: string, data: unknown): Promise<void> {
    const fullPath = join(tmpDir, relPath);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, JSON.stringify(data), "utf-8");
  }

  it("returns defaults when no config files exist", async () => {
    const config = await loadConfig(tmpDir, tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("global config overrides defaults", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", {
      timeoutMs: 60_000,
      defaults: { limit: 10 },
    });

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.timeoutMs).toBe(60_000);
    expect(config.defaults.limit).toBe(10);
    expect(config.organization).toBeUndefined();
  });

  it("project config overrides global", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", {
      timeoutMs: 60_000,
      defaults: { limit: 10 },
    });

    await writeJson(".pi/pi-ghsearch.json", {
      timeoutMs: 90_000,
      organization: "acme",
    });

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.timeoutMs).toBe(90_000); // project overrides
    expect(config.organization).toBe("acme"); // project adds
    expect(config.defaults.limit).toBe(10); // global survives (not overridden)
  });

  it("malformed JSON is handled gracefully", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Write malformed JSON to project config
    const projectPath = join(tmpDir, ".pi", "pi-ghsearch.json");
    await mkdir(join(projectPath, ".."), { recursive: true });
    await writeFile(projectPath, "not json {{{", "utf-8");

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG); // falls back to defaults
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse config"),
    );
  });

  it("missing optional keys don't crash", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", { organization: "my-org" });

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.organization).toBe("my-org");
    // Everything else is from defaults
    expect(config.timeoutMs).toBe(DEFAULT_CONFIG.timeoutMs);
    expect(config.defaults).toEqual(DEFAULT_CONFIG.defaults);
  });

  it("empty JSON file doesn't crash", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", {});

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("organization is applied as a string", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", {
      organization: "acme-corp",
    });

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.organization).toBe("acme-corp");
  });

  it("banBashGh defaults to undefined (no blocking)", async () => {
    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.banBashGh).toBeUndefined();
  });

  it("banBashGh true from global config", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", { banBashGh: true });

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.banBashGh).toBe(true);
  });

  it("banBashGh false overrides true from global", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", { banBashGh: true });
    await writeJson(".pi/pi-ghsearch.json", { banBashGh: false });

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.banBashGh).toBe(false);
  });

  it("banBashGh ignores non-boolean values", async () => {
    await writeJson(".pi/agent/pi-ghsearch.json", { banBashGh: "yes" });

    const config = await loadConfig(tmpDir, tmpDir);
    expect(config.banBashGh).toBeUndefined(); // not a boolean, ignored
  });
});
