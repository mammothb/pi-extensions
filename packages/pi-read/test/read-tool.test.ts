import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { detectLanguage } from "../src/lib/tree-sitter/languages.js";
import { decideRead } from "../src/read-tool.js";

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
  it("outlines when over the line threshold", () => {
    expect(decideRead(DEFAULT_CONFIG, 5000, 100)).toBe("outline");
  });

  it("outlines when over the byte threshold", () => {
    expect(decideRead(DEFAULT_CONFIG, 100, 100_000)).toBe("outline");
  });

  it("delegates when under both thresholds", () => {
    expect(decideRead(DEFAULT_CONFIG, 100, 1000)).toBe("delegate");
  });

  it("delegates at exactly the thresholds", () => {
    expect(decideRead(DEFAULT_CONFIG, 2000, 50 * 1024)).toBe("delegate");
  });
});
