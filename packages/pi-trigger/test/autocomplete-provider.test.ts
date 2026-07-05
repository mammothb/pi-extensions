import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createAutocompleteProviderFactory } from "../src/autocomplete-provider.js";
import type { TriggerDefinition } from "../src/types.js";

function makeDef(
  namespace: "skill" | "prompt",
  name: string,
  content = "Test description",
): TriggerDefinition {
  return {
    namespace,
    name,
    content,
    filePath: `/test/${name}.md`,
    baseDir: "/test",
  };
}

/** No-op wrapped provider that returns null for everything. */
const nullProvider: AutocompleteProvider = {
  async getSuggestions() {
    return null;
  },
  applyCompletion(lines, cursorLine, cursorCol) {
    return { lines, cursorLine, cursorCol };
  },
};

function createStore(
  skills: TriggerDefinition[],
  prompts: TriggerDefinition[],
) {
  return {
    skills: new Map(skills.map((s) => [s.name, s])),
    prompts: new Map(prompts.map((p) => [p.name, p])),
  };
}

function wrap(store: ReturnType<typeof createStore>): AutocompleteProvider {
  return createAutocompleteProviderFactory(store)(nullProvider);
}

// Helper: single-line text, cursor at end
async function suggest(
  provider: AutocompleteProvider,
  text: string,
  cursorCol = text.length,
) {
  return provider.getSuggestions([text], 0, cursorCol, {
    signal: new AbortController().signal,
  });
}

describe("autocomplete-provider", () => {
  describe("getSuggestions", () => {
    it("returns matching skills for mid-text #skill: partial", async () => {
      const store = createStore(
        [makeDef("skill", "my-skill"), makeDef("skill", "other")],
        [],
      );
      const result = await suggest(wrap(store), "use #skill:my-");
      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(1);
      expect(result!.items[0]!.label).toBe("my-skill");
      expect(result!.items[0]!.value).toBe("#skill:my-skill");
      expect(result!.prefix).toBe("#skill:my-");
    });

    it("returns matching prompts for mid-text #prompt: partial", async () => {
      const store = createStore(
        [],
        [makeDef("prompt", "plan"), makeDef("prompt", "review")],
      );
      const result = await suggest(wrap(store), "use #prompt:pla");
      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(1);
      expect(result!.items[0]!.label).toBe("plan");
      expect(result!.items[0]!.value).toBe("#prompt:plan");
      expect(result!.prefix).toBe("#prompt:pla");
    });

    it("shows all skills when partial is empty (cursor after colon)", async () => {
      const store = createStore(
        [makeDef("skill", "a"), makeDef("skill", "b")],
        [],
      );
      const result = await suggest(wrap(store), "use #skill:");
      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(2);
      expect(result!.prefix).toBe("#skill:");
    });

    it("shows all prompts when partial is empty", async () => {
      const store = createStore(
        [],
        [makeDef("prompt", "x"), makeDef("prompt", "y")],
      );
      const result = await suggest(wrap(store), "use #prompt:");
      expect(result).not.toBeNull();
      expect(result!.items).toHaveLength(2);
    });

    it("returns null when no skills match", async () => {
      const store = createStore([makeDef("skill", "foo")], []);
      const result = await suggest(wrap(store), "use #skill:zzz");
      expect(result).toBeNull();
    });

    it("returns null when store is empty", async () => {
      const store = createStore([], []);
      const result = await suggest(wrap(store), "use #skill:foo");
      expect(result).toBeNull();
    });

    it("delegates when no trigger token present", async () => {
      const store = createStore([makeDef("skill", "foo")], []);
      const result = await suggest(wrap(store), "hello world");
      expect(result).toBeNull();
    });

    it("does not match /-prefixed tokens", async () => {
      const store = createStore([makeDef("skill", "foo")], []);
      const result = await suggest(wrap(store), "/skill:fo");
      expect(result).toBeNull();
    });

    it("delegates when token is completed (trailing space)", async () => {
      const store = createStore([makeDef("skill", "foo")], []);
      const truncated = await suggest(
        wrap(store),
        "use #skill:foo extra",
        "use #skill:foo".length,
      );
      expect(truncated).not.toBeNull();
      expect(truncated!.items).toHaveLength(1);
    });

    it("matches rightmost token when multiple exist", async () => {
      const store = createStore(
        [makeDef("skill", "foo"), makeDef("skill", "bar")],
        [makeDef("prompt", "baz")],
      );
      const result = await suggest(
        wrap(store),
        "use #skill:foo and #prompt:ba",
      );
      expect(result).not.toBeNull();
      expect(result!.prefix).toBe("#prompt:ba");
      expect(result!.items[0]!.label).toBe("baz");
    });

    it("includes description from first line of content", async () => {
      const store = createStore(
        [makeDef("skill", "build", "# Build stuff\n\nLonger body here")],
        [],
      );
      const result = await suggest(wrap(store), "use #skill:bui");
      expect(result).not.toBeNull();
      expect(result!.items[0]!.description).toBe("Build stuff");
    });

    it("truncates long descriptions", async () => {
      const store = createStore(
        [
          makeDef(
            "skill",
            "verbose",
            "This is a very long description that exceeds eighty characters and should be truncated properly",
          ),
        ],
        [],
      );
      const result = await suggest(wrap(store), "use #skill:ver");
      expect(result).not.toBeNull();
      const desc = result!.items[0]!.description!;
      expect(desc.length).toBeLessThanOrEqual(80);
      expect(desc.endsWith("...")).toBe(true);
    });

    it("handles multi-line input with cursor on different line", async () => {
      const store = createStore([makeDef("skill", "foo")], []);
      const result = await wrap(store).getSuggestions(
        ["first line", "use #skill:fo"],
        1,
        "use #skill:fo".length,
        { signal: new AbortController().signal },
      );
      expect(result).not.toBeNull();
      expect(result!.items[0]!.label).toBe("foo");
    });
  });

  describe("applyCompletion", () => {
    it("replaces prefix with completed value mid-text", () => {
      const provider = wrap(createStore([], []));
      const result = provider.applyCompletion(
        ["hello #skill:my- world"],
        0,
        "hello #skill:my-".length,
        { value: "#skill:my-skill", label: "my-skill" },
        "#skill:my-",
      );
      expect(result.lines[0]).toBe("hello #skill:my-skill  world");
      expect(result.cursorCol).toBe("hello #skill:my-skill ".length);
    });

    it("handles start-of-line trigger completion", () => {
      const provider = wrap(createStore([], []));
      const result = provider.applyCompletion(
        ["#prompt:pla"],
        0,
        "#prompt:pla".length,
        { value: "#prompt:plan", label: "plan" },
        "#prompt:pla",
      );
      expect(result.lines[0]).toBe("#prompt:plan ");
      expect(result.cursorCol).toBe("#prompt:plan ".length);
    });

    it("preserves text after cursor", () => {
      const provider = wrap(createStore([], []));
      const result = provider.applyCompletion(
        ["before #skill:ab after"],
        0,
        "before #skill:ab".length,
        { value: "#skill:abc", label: "abc" },
        "#skill:ab",
      );
      expect(result.lines[0]).toBe("before #skill:abc  after");
    });

    it("handles empty after-cursor", () => {
      const provider = wrap(createStore([], []));
      const result = provider.applyCompletion(
        ["prefix #skill:ab"],
        0,
        "prefix #skill:ab".length,
        { value: "#skill:abc", label: "abc" },
        "#skill:ab",
      );
      expect(result.lines[0]).toBe("prefix #skill:abc ");
    });

    it("handles multi-line with cursor on different line", () => {
      const provider = wrap(createStore([], []));
      const result = provider.applyCompletion(
        ["first line", "use #skill:ab"],
        1,
        "use #skill:ab".length,
        { value: "#skill:abc", label: "abc" },
        "#skill:ab",
      );
      expect(result.cursorLine).toBe(1);
      expect(result.lines[0]).toBe("first line");
      expect(result.lines[1]).toBe("use #skill:abc ");
      expect(result.cursorCol).toBe("use #skill:abc ".length);
    });
  });

  describe("delegation", () => {
    it("delegates getSuggestions to wrapped provider when no trigger token", async () => {
      let delegated = false;
      const wrapped: AutocompleteProvider = {
        async getSuggestions() {
          delegated = true;
          return null;
        },
        applyCompletion(lines, cursorLine, cursorCol) {
          return { lines, cursorLine, cursorCol };
        },
      };
      const store = createStore([makeDef("skill", "foo")], []);
      const provider = createAutocompleteProviderFactory(store)(wrapped);
      await suggest(provider, "/model");
      expect(delegated).toBe(true);
    });

    it("preserves wrapped provider triggerCharacters", () => {
      const wrapped: AutocompleteProvider = {
        ...nullProvider,
        triggerCharacters: ["$"],
      };
      const store = createStore([], []);
      const provider = createAutocompleteProviderFactory(store)(wrapped);
      expect(provider.triggerCharacters).toEqual(["$"]);
    });

    it("delegates applyCompletion to wrapped for non-trigger prefixes", () => {
      let delegated = false;
      const wrapped: AutocompleteProvider = {
        async getSuggestions() {
          return null;
        },
        applyCompletion(lines, cursorLine, cursorCol, _item, _prefix) {
          delegated = true;
          return { lines, cursorLine, cursorCol };
        },
      };
      const store = createStore([], []);
      const provider = createAutocompleteProviderFactory(store)(wrapped);
      provider.applyCompletion(
        ["/reload"],
        0,
        7,
        { value: "reload", label: "reload" },
        "/reload",
      );
      expect(delegated).toBe(true);
    });

    it("handles #-prefixed trigger-token applyCompletion", () => {
      const provider = wrap(createStore([], []));
      const result = provider.applyCompletion(
        ["hello #skill:my- world"],
        0,
        "hello #skill:my-".length,
        { value: "#skill:my-skill", label: "my-skill" },
        "#skill:my-",
      );
      expect(result.lines[0]).toBe("hello #skill:my-skill  world");
    });

    it("handles #-prefixed trigger-token applyCompletion", () => {
      const provider = wrap(createStore([], []));
      const result = provider.applyCompletion(
        ["hello #skill:my- world"],
        0,
        "hello #skill:my-".length,
        { value: "#skill:my-skill", label: "my-skill" },
        "#skill:my-",
      );
      expect(result.lines[0]).toBe("hello #skill:my-skill  world");
    });

    it("delegates shouldTriggerFileCompletion to wrapped provider", () => {
      const wrapped: AutocompleteProvider = {
        async getSuggestions() {
          return null;
        },
        applyCompletion(lines, cursorLine, cursorCol) {
          return { lines, cursorLine, cursorCol };
        },
        shouldTriggerFileCompletion() {
          return true;
        },
      };
      const store = createStore([], []);
      const provider = createAutocompleteProviderFactory(store)(wrapped);
      expect(provider.shouldTriggerFileCompletion?.(["test"], 0, 5)).toBe(true);
    });
  });
});
