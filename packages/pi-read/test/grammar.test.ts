import { describe, expect, it, vi } from "vitest";
import { loadGrammar } from "../src/lib/tree-sitter/parser.js";
import type { LanguageId } from "../src/types.js";

const ALL: LanguageId[] = [
  "typescript",
  "tsx",
  "javascript",
  "csharp",
  "python",
  "rust",
];

describe("loadGrammar", () => {
  it("loads a distinct language for every supported id", async () => {
    const loaded = await Promise.all(ALL.map((id) => loadGrammar(id)));
    for (const lang of loaded) {
      expect(lang).not.toBeNull();
    }
    expect(new Set(loaded).size).toBe(ALL.length);
  });

  it("returns null for an unknown id", async () => {
    await expect(loadGrammar("nope" as LanguageId)).resolves.toBeNull();
  });

  it("returns null (no throw) when the runtime is unavailable", async () => {
    vi.resetModules();
    vi.doMock("web-tree-sitter", () => ({
      Parser: {
        init: async () => {
          throw new Error("web-tree-sitter not installed");
        },
      },
      Language: {
        load: async () => {
          throw new Error("web-tree-sitter not installed");
        },
      },
    }));
    const fresh = await import("../src/lib/tree-sitter/parser.js");
    await expect(fresh.loadGrammar("python")).resolves.toBeNull();
  });
});
