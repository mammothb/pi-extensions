import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";

// Mock getAgentDir to point to a temp directory
const agentDir = join(tmpdir(), "pi-permissions-test-agent");
const cwd = join(tmpdir(), "pi-permissions-test-project");

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDir,
}));

beforeEach(() => {
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
});

afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns all defaults when no config files exist", () => {
    const config = loadConfig(cwd);
    expect(config.defaults.tools).toBe("ask");
    expect(config.defaults.bash).toBe("ask");
    expect(config.defaults.paths).toBe("ask");
    expect(config.tools).toEqual({});
    expect(config.paths).toEqual({});
    expect(config.bashArbiterPath).toBeUndefined();
  });

  it("loads global config file", () => {
    writeFileSync(
      join(agentDir, "pi-permissions.json"),
      JSON.stringify({
        tools: { read: "allow" },
        defaults: { tools: "deny" },
      }),
    );

    const config = loadConfig(cwd);
    expect(config.tools).toEqual({ read: "allow" });
    expect(config.defaults.tools).toBe("deny");
    // Other defaults unchanged
    expect(config.defaults.bash).toBe("ask");
  });

  it("project config overrides global config", () => {
    writeFileSync(
      join(agentDir, "pi-permissions.json"),
      JSON.stringify({
        tools: { read: "allow", write: "deny" },
      }),
    );
    writeFileSync(
      join(cwd, ".pi", "pi-permissions.json"),
      JSON.stringify({
        tools: { write: "ask" },
      }),
    );

    const config = loadConfig(cwd);
    // project overrides global for write, inherits read from global
    expect(config.tools).toEqual({ read: "allow", write: "ask" });
  });

  it("project defaults overrides global defaults partially", () => {
    writeFileSync(
      join(agentDir, "pi-permissions.json"),
      JSON.stringify({
        defaults: { tools: "deny", bash: "deny" },
      }),
    );
    writeFileSync(
      join(cwd, ".pi", "pi-permissions.json"),
      JSON.stringify({
        defaults: { tools: "ask" },
      }),
    );

    const config = loadConfig(cwd);
    expect(config.defaults.tools).toBe("ask"); // overridden by project
    expect(config.defaults.bash).toBe("deny"); // inherited from global
    expect(config.defaults.paths).toBe("ask"); // default
  });

  it("falls back to defaults on invalid JSON", () => {
    writeFileSync(join(agentDir, "pi-permissions.json"), "not valid json {{{");

    const config = loadConfig(cwd);
    // Should still get defaults after parse failure
    expect(config.defaults.tools).toBe("ask");
    expect(config.tools).toEqual({});
  });

  it("resolves arbiter path with tilde expansion", () => {
    writeFileSync(
      join(agentDir, "pi-permissions.json"),
      JSON.stringify({
        bash: { arbiter: "~/.pi/bash-arbiter.sh" },
      }),
    );

    const config = loadConfig(cwd);
    expect(config.bashArbiterPath).toBeTruthy();
    expect(config.bashArbiterPath).not.toContain("~");
    expect(config.bashArbiterPath!.endsWith(".pi/bash-arbiter.sh")).toBe(true);
  });

  it("resolves relative arbiter path against cwd", () => {
    writeFileSync(
      join(agentDir, "pi-permissions.json"),
      JSON.stringify({
        bash: { arbiter: ".pi/arbiters/bash-arbiter.sh" },
      }),
    );

    const config = loadConfig(cwd);
    expect(config.bashArbiterPath).toBe(
      join(cwd, ".pi", "arbiters", "bash-arbiter.sh"),
    );
  });

  it("project arbiter overrides global arbiter", () => {
    writeFileSync(
      join(agentDir, "pi-permissions.json"),
      JSON.stringify({
        bash: { arbiter: "/global/arbiter.sh" },
      }),
    );
    writeFileSync(
      join(cwd, ".pi", "pi-permissions.json"),
      JSON.stringify({
        bash: { arbiter: "/project/arbiter.sh" },
      }),
    );

    const config = loadConfig(cwd);
    expect(config.bashArbiterPath).toBe("/project/arbiter.sh");
  });

  it("empty global config is valid (no tools/paths/bash keys)", () => {
    writeFileSync(join(agentDir, "pi-permissions.json"), JSON.stringify({}));

    const config = loadConfig(cwd);
    expect(config.defaults.tools).toBe("ask");
    expect(config.tools).toEqual({});
    expect(config.paths).toEqual({});
    expect(config.bashArbiterPath).toBeUndefined();
  });
});
