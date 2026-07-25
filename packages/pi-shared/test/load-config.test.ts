import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPiConfig, readConfigFile } from "../src/load-config.js";

let tmpDir: string;
let agentDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `pi-shared-config-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  agentDir = join(tmpDir, "agent");
  projectDir = join(tmpDir, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(projectDir, ".pi"), { recursive: true });

  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeGlobalFile(name: string, content: unknown): void {
  writeFileSync(join(agentDir, name), JSON.stringify(content, null, 2));
}

function writeProjectFile(name: string, content: unknown): void {
  writeFileSync(
    join(projectDir, ".pi", name),
    JSON.stringify(content, null, 2),
  );
}

// ---------------------------------------------------------------------------
// readConfigFile
// ---------------------------------------------------------------------------

describe("readConfigFile", () => {
  it("returns parsed JSON when file exists and is valid", () => {
    const filePath = join(tmpDir, "valid.json");
    writeFileSync(filePath, JSON.stringify({ key: "value" }));
    expect(readConfigFile(filePath, "test")).toEqual({ key: "value" });
  });

  it("returns null when file does not exist", () => {
    const filePath = join(tmpDir, "nonexistent.json");
    expect(readConfigFile(filePath, "test")).toBeNull();
  });

  it("returns null and logs error when JSON is invalid", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, "this is not json {{{");

    expect(readConfigFile(filePath, "test")).toBeNull();
    expect(consoleSpy).toHaveBeenCalled();
    const msg = consoleSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("test:");
    expect(msg).toContain("failed to parse config");
    expect(msg).toContain(filePath);

    consoleSpy.mockRestore();
  });

  it("handles empty JSON object", () => {
    const filePath = join(tmpDir, "empty.json");
    writeFileSync(filePath, "{}");
    expect(readConfigFile(filePath, "test")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// loadPiConfig
// ---------------------------------------------------------------------------

interface TestConfig {
  foo: string;
  bar?: number;
  baz?: boolean;
}

const defaults: TestConfig = { foo: "default" };

function mergeConfig(base: TestConfig, overrides: Record<string, unknown>) {
  return { ...base, ...overrides };
}

describe("loadPiConfig", () => {
  it("returns defaults when no config files exist", () => {
    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );
    expect(config).toEqual({ foo: "default" });
  });

  it("loads global config and merges with defaults", () => {
    writeGlobalFile("my-ext.json", { bar: 42 });
    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );
    expect(config).toEqual({ foo: "default", bar: 42 });
  });

  it("loads project config and merges over global", () => {
    writeGlobalFile("my-ext.json", { bar: 42 });
    writeProjectFile("my-ext.json", { baz: true });
    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );
    expect(config).toEqual({ foo: "default", bar: 42, baz: true });
  });

  it("project config overrides global config on same key", () => {
    writeGlobalFile("my-ext.json", { foo: "global" });
    writeProjectFile("my-ext.json", { foo: "project" });
    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );
    expect(config).toEqual({ foo: "project" });
  });

  it("only project config exists (no global)", () => {
    writeProjectFile("my-ext.json", { foo: "project-only" });
    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );
    expect(config).toEqual({ foo: "project-only" });
  });

  it("handles invalid global config gracefully", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(join(agentDir, "my-ext.json"), "not-json!!!");
    writeProjectFile("my-ext.json", { foo: "from-project" });

    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );

    // Invalid global is treated as null → project still applies
    expect(config).toEqual({ foo: "from-project" });
    consoleSpy.mockRestore();
  });

  it("handles invalid project config gracefully", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeGlobalFile("my-ext.json", { bar: 99 });
    writeFileSync(join(projectDir, ".pi", "my-ext.json"), "bad json ]]]");

    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );

    // Invalid project → global still applies
    expect(config).toEqual({ foo: "default", bar: 99 });
    consoleSpy.mockRestore();
  });

  it("strips .json from packageName for the error label", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(join(agentDir, "pi-eval.json"), "corrupt!!!!");

    loadPiConfig("pi-eval.json", projectDir, defaults, mergeConfig);

    const msg = consoleSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("pi-eval:");
    consoleSpy.mockRestore();
  });

  it("handles packageName without .json extension", () => {
    writeGlobalFile("my-ext.json", { bar: 7 });
    const config = loadPiConfig(
      "my-ext.json",
      projectDir,
      defaults,
      mergeConfig,
    );
    expect(config.bar).toBe(7);
  });

  it("does not mutate the defaults object", () => {
    writeGlobalFile("my-ext.json", { foo: "changed" });
    const original = { ...defaults };
    loadPiConfig("my-ext.json", projectDir, defaults, mergeConfig);
    expect(defaults).toEqual(original);
  });
});
