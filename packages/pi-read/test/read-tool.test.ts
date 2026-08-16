import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { detectLanguage } from "../src/lib/tree-sitter/languages.js";
import { decideRead } from "../src/read-tool.js";

const STAT = {
  isDirectory: false,
  lineCount: 5000,
  byteLength: 400_000,
};

describe("detectLanguage", () => {
  it("maps known extensions", () => {
    expect(detectLanguage("src/server.ts")).toBe("typescript");
    expect(detectLanguage("app.tsx")).toBe("tsx");
    expect(detectLanguage("Program.cs")).toBe("csharp");
    expect(detectLanguage("lib.rs")).toBe("rust");
  });

  it("is case-insensitive and returns null for unknown types", () => {
    expect(detectLanguage("src/Server.TS")).toBe("typescript");
    expect(detectLanguage("README.md")).toBeNull();
    expect(detectLanguage("data.json")).toBeNull();
    expect(detectLanguage("image.png")).toBeNull();
  });
});

describe("decideRead", () => {
  it("outlines large, supported, enabled files", () => {
    expect(
      decideRead({ path: "a.ts" }, DEFAULT_CONFIG, "typescript", STAT),
    ).toBe("outline");
  });

  it("delegates small files", () => {
    expect(
      decideRead({ path: "a.ts" }, DEFAULT_CONFIG, "typescript", {
        isDirectory: false,
        lineCount: 100,
        byteLength: 2000,
      }),
    ).toBe("delegate");
  });

  it("delegates when disabled", () => {
    const config = { ...DEFAULT_CONFIG, enabled: false };
    expect(decideRead({ path: "a.ts" }, config, "typescript", STAT)).toBe(
      "delegate",
    );
  });

  it("delegates disabled languages", () => {
    const config = {
      ...DEFAULT_CONFIG,
      languages: { ...DEFAULT_CONFIG.languages, python: false },
    };
    expect(decideRead({ path: "a.py" }, config, "python", STAT)).toBe(
      "delegate",
    );
  });

  it("delegates unsupported languages", () => {
    expect(decideRead({ path: "a.md" }, DEFAULT_CONFIG, null, STAT)).toBe(
      "delegate",
    );
  });

  it("delegates offset/limit drill-downs", () => {
    expect(
      decideRead(
        { path: "a.ts", offset: 10, limit: 20 },
        DEFAULT_CONFIG,
        "typescript",
        STAT,
      ),
    ).toBe("delegate");
  });

  it("delegates directories and missing files", () => {
    expect(
      decideRead({ path: "src" }, DEFAULT_CONFIG, "typescript", {
        isDirectory: true,
        lineCount: 0,
        byteLength: 0,
      }),
    ).toBe("delegate");
    expect(
      decideRead({ path: "a.ts" }, DEFAULT_CONFIG, "typescript", null),
    ).toBe("delegate");
  });
});
