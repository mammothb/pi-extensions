import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "../src/config.js";

const { GLOBAL_DIR } = vi.hoisted(() => ({
  // process is a Node global (no import), so it's safe inside vi.hoisted's
  // pre-import callback — imported bindings (tmpdir/join) would be in TDZ here.
  GLOBAL_DIR: `${process.env.TMPDIR ?? "/tmp"}/pi-read-test-global-agent`,
}));
const projectDir = mkdtempSync(join(tmpdir(), "pi-read-project-"));
const projectPiDir = join(projectDir, ".pi");

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...actual, getAgentDir: () => GLOBAL_DIR };
});

function writeProjectFile(contents: string | null) {
  mkdirSync(projectPiDir, { recursive: true });
  const file = join(projectPiDir, "pi-read.json");
  if (contents === null) {
    rmSync(file, { force: true });
  } else {
    writeFileSync(file, contents);
  }
}

function writeGlobalFile(contents: string | null) {
  mkdirSync(GLOBAL_DIR, { recursive: true });
  const file = join(GLOBAL_DIR, "pi-read.json");
  if (contents === null) {
    rmSync(file, { force: true });
  } else {
    writeFileSync(file, contents);
  }
}

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(GLOBAL_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  writeProjectFile(null);
  writeGlobalFile(null);
});

describe("loadConfig", () => {
  it("returns defaults with no config files", () => {
    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
  });

  it("applies project config over defaults", () => {
    writeProjectFile(JSON.stringify({ thresholdLines: 100, maxDepth: 3 }));
    const config = loadConfig(projectDir);

    expect(config.thresholdLines).toBe(100);
    expect(config.maxDepth).toBe(3);
    expect(config.enabled).toBe(true);
  });

  it("applies enabled and thresholdBytes overrides", () => {
    writeProjectFile(JSON.stringify({ enabled: false, thresholdBytes: 1234 }));
    const config = loadConfig(projectDir);

    expect(config.enabled).toBe(false);
    expect(config.thresholdBytes).toBe(1234);
  });

  it("prefers project config over global", () => {
    writeGlobalFile(JSON.stringify({ thresholdLines: 500 }));
    writeProjectFile(JSON.stringify({ thresholdLines: 100 }));
    expect(loadConfig(projectDir).thresholdLines).toBe(100);
  });

  it("applies global config when no project config", () => {
    writeGlobalFile(JSON.stringify({ thresholdLines: 500 }));
    expect(loadConfig(projectDir).thresholdLines).toBe(500);
  });

  it("disables a single language via config", () => {
    writeProjectFile(JSON.stringify({ languages: { python: false } }));
    const config = loadConfig(projectDir);

    expect(config.languages.python).toBe(false);
    expect(config.languages.typescript).toBe(true);
    expect(config.languages.rust).toBe(true);
  });

  it("ignores unknown keys", () => {
    writeProjectFile(JSON.stringify({ bogus: 42, languages: { bogus: true } }));
    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
  });

  it("falls back to defaults on malformed JSON", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeProjectFile("{ not valid json");

    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe("mergeConfig validation", () => {
  it("rejects invalid thresholdLines (falls back to default)", () => {
    for (const value of [-1, 1.5, Infinity, -Infinity, NaN]) {
      expect(
        mergeConfig(DEFAULT_CONFIG, { thresholdLines: value }).thresholdLines,
      ).toBe(DEFAULT_CONFIG.thresholdLines);
    }
  });

  it("rejects invalid thresholdBytes (falls back to default)", () => {
    for (const value of [-1, 1.5, Infinity, NaN]) {
      expect(
        mergeConfig(DEFAULT_CONFIG, { thresholdBytes: value }).thresholdBytes,
      ).toBe(DEFAULT_CONFIG.thresholdBytes);
    }
  });

  it("rejects non-positive or non-integer maxDepth (falls back to default)", () => {
    for (const value of [-1, 0, 1.5, Infinity, NaN]) {
      expect(mergeConfig(DEFAULT_CONFIG, { maxDepth: value }).maxDepth).toBe(
        DEFAULT_CONFIG.maxDepth,
      );
    }
  });

  it("accepts valid thresholds and depth (including zero thresholds)", () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      thresholdLines: 0,
      thresholdBytes: 0,
      maxBytes: 4096,
      maxDepth: 1,
    });
    expect(config.thresholdLines).toBe(0);
    expect(config.thresholdBytes).toBe(0);
    expect(config.maxBytes).toBe(4096);
    expect(config.maxDepth).toBe(1);
  });
});
