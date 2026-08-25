import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveSecret, resolveSecrets } from "../src/resolve-secret.js";

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = join(tmpdir(), `pi-shared-secret-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  prevEnv = process.env.PI_SHARED_TEST_SECRET;
});

afterEach(() => {
  if (prevEnv === undefined) {
    delete process.env.PI_SHARED_TEST_SECRET;
  } else {
    process.env.PI_SHARED_TEST_SECRET = prevEnv;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveSecret", () => {
  it("returns literal values unchanged (no prefix)", () => {
    expect(resolveSecret("plain-key")).toBe("plain-key");
    expect(resolveSecret("")).toBe("");
  });

  it("resolves an env: reference", () => {
    process.env.PI_SHARED_TEST_SECRET = "from-env";
    expect(resolveSecret("env:PI_SHARED_TEST_SECRET")).toBe("from-env");
  });

  it("falls back to the literal when the env var is missing", () => {
    delete process.env.PI_SHARED_TEST_SECRET;
    expect(resolveSecret("env:PI_SHARED_TEST_SECRET")).toBe(
      "env:PI_SHARED_TEST_SECRET",
    );
  });

  it("resolves a file: reference and trims whitespace", () => {
    const file = join(tmpDir, "secret.txt");
    writeFileSync(file, "  key-with-newline\n");
    expect(resolveSecret(`file:${file}`)).toBe("key-with-newline");
  });

  it("falls back to the literal when the file is missing", () => {
    const file = join(tmpDir, "does-not-exist.txt");
    expect(resolveSecret(`file:${file}`)).toBe(`file:${file}`);
  });

  it("falls back to the literal when the file cannot be read", () => {
    const dir = join(tmpDir, "a-directory");
    mkdirSync(dir);
    expect(resolveSecret(`file:${dir}`)).toBe(`file:${dir}`);
  });

  it("resolves a cmd: reference and trims stdout", () => {
    expect(resolveSecret("cmd:echo hello-token")).toBe("hello-token");
  });

  it("tokenizes quoted cmd: arguments", () => {
    expect(resolveSecret('cmd:echo "two  spaces"')).toBe("two  spaces");
  });

  it("falls back to the literal when the command fails", () => {
    expect(resolveSecret("cmd:false")).toBe("cmd:false");
  });

  it("falls back to the literal when the command is missing", () => {
    expect(resolveSecret("cmd:pi-shared-no-such-binary-xyz --version")).toBe(
      "cmd:pi-shared-no-such-binary-xyz --version",
    );
  });

  it("expands a leading tilde in a file: path", () => {
    const prevHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      // `~` is expanded via expandTilde (which uses os.homedir(), honoring
      // $HOME on POSIX), so file:~/... resolves under the temp HOME.
      const file = join(tmpDir, "home-secret.txt");
      writeFileSync(file, "home-key-value");
      expect(resolveSecret("file:~/home-secret.txt")).toBe("home-key-value");
    } finally {
      if (prevHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = prevHome;
      }
    }
  });
});

describe("resolveSecrets", () => {
  it("resolves every value in a record", () => {
    process.env.PI_SHARED_TEST_SECRET = "env-value";
    const file = join(tmpDir, "k.txt");
    writeFileSync(file, "file-value");

    const result = resolveSecrets({
      fromEnv: "env:PI_SHARED_TEST_SECRET",
      fromFile: `file:${file}`,
      literal: "unchanged",
    });

    expect(result).toEqual({
      fromEnv: "env-value",
      fromFile: "file-value",
      literal: "unchanged",
    });
  });

  it("returns an empty record for empty input", () => {
    expect(resolveSecrets({})).toEqual({});
  });
});
