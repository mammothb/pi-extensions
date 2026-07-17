import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/bw/config.js";

const cwd = join(tmpdir(), "bw-test-project");
const configDir = join(tmpdir(), "bw-test-xdg-config", "bw");

beforeEach(() => {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = join(tmpdir(), "bw-test-xdg-config");
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(join(tmpdir(), "bw-test-xdg-config"), {
    recursive: true,
    force: true,
  });
  delete process.env.XDG_CONFIG_HOME;
});

describe("loadConfig", () => {
  it("returns defaults when no config files exist", () => {
    const cfg = loadConfig(cwd);
    // Compare binds arrays (paths are expanded, so check against expanded defaults)
    expect(cfg.binds.ro).toEqual(["/bin", "/etc", "/sbin", "/usr"]);
    // roTry has home-relative paths (tilde-expanded)
    expect(cfg.binds.roTry).toContain(join(homedir(), ".cargo"));
    expect(cfg.options.clearenv).toBe(true);
    // Default env is populated on WSL2 with WSL_* vars; empty otherwise
    if (process.env.WSL_INTEROP) {
      expect(cfg.options.env.WSL_INTEROP).toBeTruthy();
      expect(cfg.options.env.WSL_DISTRO_NAME).toBeTruthy();
    }
    expect(cfg.options.tmpfsSize).toBe("512M");
    expect(cfg.options.unshareNet).toBe(false);
  });

  it("binds_extra from global appends to defaults", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        binds_extra: {
          ro: ["~/extra-ro"],
          rw: ["~/extra-rw"],
        },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.ro).toContain(join(homedir(), "extra-ro"));
    expect(cfg.binds.rw).toContain(join(homedir(), "extra-rw"));
    // Defaults still present
    expect(cfg.binds.ro).toContain("/usr");
  });

  it("binds_extra from workspace appends on top of global", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        binds_extra: { ro: ["~/global-ro"] },
      }),
    );
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds_extra: { ro: ["~/project-ro"] },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.ro).toContain(join(homedir(), "global-ro"));
    expect(cfg.binds.ro).toContain(join(homedir(), "project-ro"));
  });

  it("binds (replace) from workspace discards defaults and global", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        binds_extra: { ro: ["~/global-ro"] },
      }),
    );
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds: {
          ro: ["/only-this"],
          docker: null,
        },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.ro).toEqual(["/only-this"]);
    expect(cfg.binds.roTry).toEqual([]);
    expect(cfg.binds.rw).toEqual([]);
    expect(cfg.binds.docker).toBeNull();
    // On WSL2, auto-detection re-adds WSL2 binds even after replace
    if (process.env.WSL_INTEROP) {
      expect(cfg.binds.wsl2.ro.length).toBeGreaterThan(0);
    } else {
      expect(cfg.binds.wsl2).toEqual({ ro: [], roTry: [] });
    }
    // global extra is gone
    expect(cfg.binds.ro).not.toContain(join(homedir(), "global-ro"));
  });

  it("binds + binds_extra in same layer: replace lower first, then merge own extra", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds: { ro: ["/base"], rw: ["/base-rw"] },
        binds_extra: { ro: ["/extra"], rw: ["/extra-rw"] },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.ro).toEqual(["/base", "/extra"]);
    expect(cfg.binds.rw).toEqual(["/base-rw", "/extra-rw"]);
    // defaults discarded
    expect(cfg.binds.ro).not.toContain("/usr");
  });

  it("docker: null disables", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ binds_extra: { docker: null } }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.docker).toBeNull();
  });

  it("docker: custom path overrides", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ binds_extra: { docker: "/custom/sock" } }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.docker).toBe("/custom/sock");
  });

  it("wsl2 shallow merge: overrides individual keys", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds_extra: {
          wsl2: { ro: ["/custom-wsl-ro"] },
        },
      }),
    );

    const cfg = loadConfig(cwd);
    // On non-WSL, defaults are empty; workspace adds custom
    expect(cfg.binds.wsl2.ro).toContain("/custom-wsl-ro");
    // roTry untouched
    expect(cfg.binds.wsl2.roTry).toEqual([]);
  });

  it("options: shallow merge", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ options: { tmpfsSize: "256M" } }),
    );
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ options: { unshareNet: true } }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.options.tmpfsSize).toBe("256M"); // from global
    expect(cfg.options.unshareNet).toBe(true); // from workspace
    expect(cfg.options.clearenv).toBe(true); // from default
  });

  it("options.env: merged shallow (workspace overrides specific keys)", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        options: {
          env: { FOO: "bar", SHARED: "from-global" },
        },
      }),
    );
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        options: {
          env: { SHARED: "from-workspace", BAZ: "qux" },
        },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.options.env.FOO).toBe("bar");
    expect(cfg.options.env.SHARED).toBe("from-workspace");
    expect(cfg.options.env.BAZ).toBe("qux");
    // WSL2 env vars may also be present (auto-detection)
  });

  it("tilde paths are expanded", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds_extra: { ro: ["~/my-docs"] },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.ro).toContain(join(homedir(), "my-docs"));
    expect(cfg.binds.ro.every((p) => !p.startsWith("~"))).toBe(true);
  });

  it("relative paths are resolved against cwd", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds_extra: { rw: ["./output"] },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.rw).toContain(join(cwd, "output"));
  });

  it("absolute paths pass through unchanged", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds_extra: { ro: ["/absolute/path"] },
      }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.ro).toContain("/absolute/path");
  });

  it("invalid JSON is ignored (falls through to next layer)", () => {
    writeFileSync(join(configDir, "config.json"), "not json {{{");
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ binds_extra: { ro: ["/workspace-still-works"] } }),
    );

    const cfg = loadConfig(cwd);
    expect(cfg.binds.ro).toContain("/workspace-still-works");
    expect(cfg.binds.ro).toContain("/usr"); // defaults intact
  });

  it("empty config files are valid (no keys)", () => {
    writeFileSync(join(configDir, "config.json"), JSON.stringify({}));

    const cfg = loadConfig(cwd);
    // Should still get full defaults
    expect(cfg.binds.ro).toContain("/usr");
    expect(cfg.options.clearenv).toBe(true);
  });
});
