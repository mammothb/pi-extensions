import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBwrapArgs } from "../../src/bw/binds.js";
import { collectErrors, printBwrapArgs } from "../../src/bw/cli.js";
import { loadConfig } from "../../src/bw/config.js";

const cwd = join(tmpdir(), "bw-cli-test");
const configDir = join(tmpdir(), "bw-cli-xdg-config", "bw");

beforeEach(() => {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(configDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = join(tmpdir(), "bw-cli-xdg-config");
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(join(tmpdir(), "bw-cli-xdg-config"), { recursive: true, force: true });
  delete process.env.XDG_CONFIG_HOME;
});

describe("collectErrors", () => {
  it("returns empty when no config files exist", () => {
    const errors = collectErrors(cwd);
    expect(errors).toEqual([]);
  });

  it("returns errors for missing ro paths in workspace config", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ binds_extra: { ro: ["/nonexistent/path/foo"] } }),
    );

    const errors = collectErrors(cwd);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("/nonexistent/path/foo");
    expect(errors[0]).toContain(".pi/bw.json");
    expect(errors[0]).toContain("binds.ro[0]");
  });

  it("returns errors for missing rw paths in workspace config", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({
        binds_extra: { rw: ["./nonexistent-output"] },
      }),
    );

    const errors = collectErrors(cwd);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("binds.rw[0]");
  });

  it("returns errors for missing paths in global config", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ binds_extra: { ro: ["/nonexistent-global"] } }),
    );

    const errors = collectErrors(cwd);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("~/.config/bw/config.json");
    expect(errors[0]).toContain("/nonexistent-global");
  });

  it("returns multiple errors across global and workspace", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ binds_extra: { ro: ["/missing-global"] } }),
    );
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ binds_extra: { ro: ["/missing-workspace"] } }),
    );

    const errors = collectErrors(cwd);
    expect(errors.length).toBe(2);
    expect(errors[0]).toContain("~/.config/bw/config.json");
    expect(errors[1]).toContain(".pi/bw.json");
  });

  it("skips validation for roTry entries", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ binds_extra: { roTry: ["/nonexistent-rotry"] } }),
    );

    const errors = collectErrors(cwd);
    expect(errors).toEqual([]);
  });

  it("returns empty for valid config (existing paths)", () => {
    writeFileSync(
      join(cwd, ".pi", "bw.json"),
      JSON.stringify({ binds_extra: { ro: ["/usr"] } }),
    );

    const errors = collectErrors(cwd);
    expect(errors).toEqual([]);
  });
});

describe("--print-args output", () => {
  it("builds args array starting with bwrap and ending with command", () => {
    const config = loadConfig(cwd);
    const args = buildBwrapArgs(config, cwd, ["pi"]);

    expect(args[0]).toBe("bwrap");
    expect(args[args.length - 2]).toBe("--");
    expect(args[args.length - 1]).toBe("pi");
  });

  it("includes ro binds", () => {
    const config = loadConfig(cwd);
    const args = buildBwrapArgs(config, cwd, ["bash"]);

    // --ro-bind for default entries like /usr
    const usrIdx = args.indexOf("/usr");
    expect(usrIdx).toBeGreaterThan(0);
    expect(args[usrIdx - 1]).toBe("--ro-bind");
  });

  it("includes workspace bind", () => {
    const config = loadConfig(cwd);
    const args = buildBwrapArgs(config, cwd, ["bash"]);

    // Workspace bound rw
    expect(args).toContain(cwd);
    const cwdIdx = args.indexOf(cwd);
    // Should find two occurrences: one for bind, one for chdir
    expect(cwdIdx).toBeGreaterThan(0);
  });

  it("--unshare-net not present by default", () => {
    const config = loadConfig(cwd);
    const args = buildBwrapArgs(config, cwd, ["bash"]);
    expect(args).not.toContain("--unshare-net");
  });

  it("printBwrapArgs produces output (smoke test)", () => {
    // Just verify it doesn't throw
    expect(() => {
      printBwrapArgs([
        "bwrap",
        "--unshare-user",
        "--ro-bind",
        "/usr",
        "/usr",
        "--",
        "pi",
      ]);
    }).not.toThrow();
  });
});

describe("--validate exit behavior", () => {
  it("loadConfig succeeds with default config", () => {
    // Sanity: defaults should always load without errors
    expect(() => loadConfig(cwd)).not.toThrow();
  });

  it("collectErrors returns empty for default-only config", () => {
    // Without any user config, defaults are assumed valid (not checked)
    const errors = collectErrors(cwd);
    expect(errors).toEqual([]);
  });
});
