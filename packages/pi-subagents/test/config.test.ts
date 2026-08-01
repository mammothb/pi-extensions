import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

// End-to-end test of loadConfig using real temp directories (same approach
// as pi-web's config.test.ts — no mocking of getAgentDir).

let tmpDir: string;
let agentDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `pi-subagents-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("loadConfig", () => {
  it("returns defaults when no config files exist", () => {
    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
  });

  it("loads global config", () => {
    writeFileSync(
      join(agentDir, "pi-subagents.json"),
      JSON.stringify({ focusOnStart: false }),
    );
    expect(loadConfig(projectDir).focusOnStart).toBe(false);
  });

  it("loads project config", () => {
    writeFileSync(
      join(projectDir, ".pi", "pi-subagents.json"),
      JSON.stringify({ focusOnStart: false }),
    );
    expect(loadConfig(projectDir).focusOnStart).toBe(false);
  });

  it("project config overrides global config", () => {
    writeFileSync(
      join(agentDir, "pi-subagents.json"),
      JSON.stringify({ focusOnStart: true }),
    );
    writeFileSync(
      join(projectDir, ".pi", "pi-subagents.json"),
      JSON.stringify({ focusOnStart: false }),
    );
    expect(loadConfig(projectDir).focusOnStart).toBe(false);
  });

  it("ignores unknown fields", () => {
    writeFileSync(
      join(projectDir, ".pi", "pi-subagents.json"),
      JSON.stringify({ focusOnStart: false, bogus: 42 }),
    );
    const config = loadConfig(projectDir);
    expect(config.focusOnStart).toBe(false);
  });

  it("ignores wrong-typed values", () => {
    writeFileSync(
      join(projectDir, ".pi", "pi-subagents.json"),
      JSON.stringify({ focusOnStart: "yes" }),
    );
    expect(loadConfig(projectDir).focusOnStart).toBe(
      DEFAULT_CONFIG.focusOnStart,
    );
  });

  it("handles malformed JSON gracefully (falls back to defaults)", () => {
    writeFileSync(join(projectDir, ".pi", "pi-subagents.json"), "{ not json }");
    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
  });
});
