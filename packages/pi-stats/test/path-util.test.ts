import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getExtNameFromPath,
  getLocalEntryExtensionName,
} from "../src/path-util.js";

describe("getExtNameFromPath", () => {
  it("extracts scoped package name from node_modules path", () => {
    const result = getExtNameFromPath(
      "/project/node_modules/@mammothb/pi-ask/index.ts",
    );
    expect(result).toBe("@mammothb/pi-ask");
  });

  it("extracts unscoped package name from node_modules path", () => {
    const result = getExtNameFromPath(
      "/project/node_modules/vitest/dist/index.js",
    );
    expect(result).toBe("vitest");
  });

  it("extracts name from extensions dir path", () => {
    const result = getExtNameFromPath(
      "/home/user/.pi/agent/extensions/my-ext/index.ts",
    );
    expect(result).toBe("my-ext");
  });

  it("extracts name from extensions dir with .ts file", () => {
    const result = getExtNameFromPath(
      "/home/user/.pi/agent/extensions/my-ext.ts",
    );
    expect(result).toBe("my-ext");
  });

  it("uses basename minus extension for unknown paths", () => {
    const result = getExtNameFromPath("/some/random/custom-script.ts");
    expect(result).toBe("custom-script");
  });

  it("strips .js extension from basename", () => {
    const result = getExtNameFromPath("/some/random/tool.js");
    expect(result).toBe("tool");
  });

  it("strips .md extension from basename", () => {
    // "/some/skill/SKILL.md" → strips .md → "SKILL"
    // But "SKILL" matches the generic entry name check, so it falls back to
    // the parent dir name "skill"
    const result = getExtNameFromPath("/some/skill/SKILL.md");
    expect(result).toBe("skill");
  });

  it("handles index file in generic dir (src, dist, lib, build, out, source)", () => {
    const result = getExtNameFromPath("/project/packages/pi-ask/src/index.ts");
    // "index" in "src" → looks at parent dir name
    expect(result).toBe("pi-ask");
  });

  it("handles SKILL.md in a generic dir", () => {
    const result = getExtNameFromPath(
      "/project/packages/pi-mermaid/skills/mermaid/SKILL.md",
    );
    // "SKILL" in skills/mermaid → falls back to mermaid
    expect(result).toBe("mermaid");
  });
});

describe("getLocalEntryExtensionName", () => {
  it("finds package name from nearby package.json via temp dir", () => {
    const tmpDir = join(
      tmpdir(),
      `pi-stats-pkg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    const nestedDir = join(tmpDir, "packages", "my-lib", "src");
    mkdirSync(nestedDir, { recursive: true });

    try {
      writeFileSync(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "my-cool-package" }),
      );

      const result = getLocalEntryExtensionName(join(nestedDir, "index.ts"));
      expect(result).toBe("my-cool-package");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns undefined when all ancestor dirs are generic (src, dist, lib, etc.)", () => {
    // All parent dirs are in GENERIC_ENTRY_DIRS set → walks to root, returns undefined
    const result = getLocalEntryExtensionName("/src/dist/index.ts");
    expect(result).toBeUndefined();
  });

  it("falls back to parent dir name when no package.json", () => {
    const result = getLocalEntryExtensionName("/opt/my-extension/index.ts");
    expect(result).toBe("my-extension");
  });
});
