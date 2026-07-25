import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  SETTINGS_PATH_DEFAULT,
  scaffoldSettings,
} from "../src/lib/compact/settings.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `pi-memory-settings-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  process.env.PI_MEMORY_CONFIG_PATH = join(tmpDir, "pi-memory.json");
});

afterEach(() => {
  delete process.env.PI_MEMORY_CONFIG_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

function configPath(): string {
  return process.env.PI_MEMORY_CONFIG_PATH!;
}

function writeSettings(data: unknown): void {
  writeFileSync(configPath(), JSON.stringify(data, null, 2));
}

describe("loadSettings", () => {
  it("returns defaults when no config file exists", () => {
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("merges valid JSON with defaults", () => {
    writeSettings({ debug: true });
    const settings = loadSettings();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, debug: true });
  });

  it("returns defaults for invalid JSON", () => {
    writeFileSync(configPath(), "not-json{{{{");
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for non-object JSON", () => {
    writeFileSync(configPath(), '"just a string"');
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("returns defaults for null", () => {
    writeFileSync(configPath(), "null");
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("preserves user values when only partial settings are present", () => {
    writeSettings({ debug: true });
    const settings = loadSettings();
    expect(settings.overrideDefaultCompaction).toBe(
      DEFAULT_SETTINGS.overrideDefaultCompaction,
    );
    expect(settings.debug).toBe(true);
  });
});

describe("scaffoldSettings", () => {
  it("creates file with defaults when missing", () => {
    scaffoldSettings();
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("fills missing keys in existing valid file", () => {
    // Write a file with only debug set
    writeSettings({ debug: true });
    scaffoldSettings();

    // Should now have all defaults plus debug: true
    const settings = loadSettings();
    expect(settings.overrideDefaultCompaction).toBe(false);
    expect(settings.debug).toBe(true);
  });

  it("preserves extra user keys in existing file", () => {
    writeSettings({ debug: true, customField: "keep-me" });
    scaffoldSettings();

    const content = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(content.customField).toBe("keep-me");
  });

  it("does not clobber file with invalid JSON", () => {
    writeFileSync(configPath(), "invalid json {{{");
    const original = readFileSync(configPath(), "utf-8");
    scaffoldSettings();
    const after = readFileSync(configPath(), "utf-8");
    // Should leave file unchanged
    expect(after).toBe(original);
  });

  it("creates parent directory if missing", () => {
    const nestedPath = join(tmpDir, "a", "b", "c", "pi-memory.json");
    process.env.PI_MEMORY_CONFIG_PATH = nestedPath;
    scaffoldSettings();

    expect(existsSync(nestedPath)).toBe(true);
    const settings = loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe("SETTINGS_PATH_DEFAULT", () => {
  it("points to ~/.pi/agent/pi-memory.json", () => {
    expect(SETTINGS_PATH_DEFAULT).toContain(".pi");
    expect(SETTINGS_PATH_DEFAULT).toContain("pi-memory.json");
  });
});
