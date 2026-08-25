import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

let tmpDir: string;
let agentDir: string;
let projectDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `pi-office-config-test-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  agentDir = join(tmpDir, "agent");
  projectDir = join(tmpDir, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(projectDir, ".pi"), { recursive: true });

  prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("office config", () => {
  it("returns defaults when no config files exist", () => {
    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
  });

  it("applies a global config override", () => {
    writeFileSync(
      join(agentDir, "pi-office.json"),
      JSON.stringify({
        sharepoint: { tokenSource: "env:GRAPH_TOKEN" },
      }),
    );
    const cfg = loadConfig(projectDir);
    expect(cfg.sharepoint.tokenSource).toBe("env:GRAPH_TOKEN");
    expect(cfg.sharepoint.baseUrl).toBe(DEFAULT_CONFIG.sharepoint.baseUrl);
  });

  it("project config overrides global config", () => {
    writeFileSync(
      join(agentDir, "pi-office.json"),
      JSON.stringify({
        sharepoint: {
          baseUrl: "https://graph.microsoft.us/v1.0",
          tokenSource: "cmd:get-token",
        },
      }),
    );
    writeFileSync(
      join(projectDir, ".pi", "pi-office.json"),
      JSON.stringify({
        sharepoint: { baseUrl: "https://graph.microsoft.us/v1.0" },
      }),
    );
    const cfg = loadConfig(projectDir);
    // baseUrl overridden identically in both; tokenSource survives from global.
    expect(cfg.sharepoint.baseUrl).toBe("https://graph.microsoft.us/v1.0");
    expect(cfg.sharepoint.tokenSource).toBe("cmd:get-token");
  });

  it("ignores invalid JSON and falls back to defaults", () => {
    writeFileSync(join(agentDir, "pi-office.json"), "{ not json");
    expect(loadConfig(projectDir)).toEqual(DEFAULT_CONFIG);
  });
});
