import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvalConfig } from "../src/config";
import { DEFAULT_CONFIG, loadConfig } from "../src/config";

let tmpDir: string;
let agentDir: string;
let projectDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `pi-eval-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function writeGlobal(config: Partial<EvalConfig>): void {
  writeFileSync(
    join(agentDir, "pi-eval.json"),
    JSON.stringify(config, null, 2),
  );
}

function writeProject(config: Partial<EvalConfig>): void {
  writeFileSync(
    join(projectDir, ".pi", "pi-eval.json"),
    JSON.stringify(config, null, 2),
  );
}

describe("loadConfig", () => {
  it("returns empty defaults when no config files exist", () => {
    const config = loadConfig(projectDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("loads pythonPath from global config", () => {
    writeGlobal({ pythonPath: ".venv/bin/python3" });
    const config = loadConfig(projectDir);

    expect(config.pythonPath).toBe(".venv/bin/python3");
    expect(config.nodeModulesPath).toBeUndefined();
  });

  it("loads nodeModulesPath from global config", () => {
    writeGlobal({ nodeModulesPath: "./node_modules" });
    const config = loadConfig(projectDir);

    expect(config.nodeModulesPath).toBe("./node_modules");
    expect(config.pythonPath).toBeUndefined();
  });

  it("loads both paths from global config", () => {
    writeGlobal({
      pythonPath: ".venv/bin/python3",
      nodeModulesPath: "./node_modules",
    });
    const config = loadConfig(projectDir);

    expect(config.pythonPath).toBe(".venv/bin/python3");
    expect(config.nodeModulesPath).toBe("./node_modules");
  });

  it("loads project config", () => {
    writeProject({ pythonPath: "/usr/local/bin/python3" });
    const config = loadConfig(projectDir);

    expect(config.pythonPath).toBe("/usr/local/bin/python3");
    expect(config.nodeModulesPath).toBeUndefined();
  });

  it("project config overrides global config", () => {
    writeGlobal({ pythonPath: ".venv/bin/python3" });
    writeProject({ pythonPath: ".venv-test/bin/python3" });

    const config = loadConfig(projectDir);
    expect(config.pythonPath).toBe(".venv-test/bin/python3");
  });

  it("project config partially overrides — unspecified keys inherit from global", () => {
    writeGlobal({
      pythonPath: ".venv/bin/python3",
      nodeModulesPath: "./node_modules",
    });
    writeProject({ pythonPath: "/usr/bin/python3" });

    const config = loadConfig(projectDir);
    expect(config.pythonPath).toBe("/usr/bin/python3");
    expect(config.nodeModulesPath).toBe("./node_modules");
  });

  it("project config adds a key not present in global", () => {
    writeGlobal({ pythonPath: ".venv/bin/python3" });
    writeProject({ nodeModulesPath: "./other_modules" });

    const config = loadConfig(projectDir);
    expect(config.pythonPath).toBe(".venv/bin/python3");
    expect(config.nodeModulesPath).toBe("./other_modules");
  });

  it("handles malformed global JSON gracefully (falls back)", () => {
    writeFileSync(join(agentDir, "pi-eval.json"), "{ not json }");
    writeProject({ pythonPath: ".venv/bin/python3" });

    const config = loadConfig(projectDir);

    // Global parse failed, project still loaded
    expect(config.pythonPath).toBe(".venv/bin/python3");
    expect(config.nodeModulesPath).toBeUndefined();
  });

  it("handles malformed project JSON gracefully (falls back)", () => {
    writeGlobal({ pythonPath: ".venv/bin/python3" });
    writeFileSync(join(projectDir, ".pi", "pi-eval.json"), "{ not json }");

    const config = loadConfig(projectDir);

    // Project parse failed, global still loaded
    expect(config.pythonPath).toBe(".venv/bin/python3");
    expect(config.nodeModulesPath).toBeUndefined();
  });
});
