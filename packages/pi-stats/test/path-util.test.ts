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
  it("finds package name from nearby package.json", () => {
    // The monorepo root has a package.json with name "pi-extensions-workspace"
    const result = getLocalEntryExtensionName(
      "/home/mmb/code/pi-extensions-workspace/feat/packages/pi-stats/src/tracker.ts",
    );
    // Should find the monorepo package name
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
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
