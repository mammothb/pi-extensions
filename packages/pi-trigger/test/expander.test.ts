import { describe, expect, it } from "vitest";
import { expandPrompt } from "../src/expander.js";
import type { TriggerDefinition } from "../src/types.js";

function makeDef(content: string): TriggerDefinition {
  return {
    namespace: "prompt",
    name: "test",
    content,
    filePath: "/fake/test.md",
    baseDir: "/fake",
  };
}

describe("expandPrompt", () => {
  it("replaces missing $1 with empty string when no args", () => {
    const result = expandPrompt(makeDef("Hello $1"));
    expect(result.content).toBe("Hello ");
  });

  it("substitutes positional args ($1, $2, $3)", () => {
    const result = expandPrompt(makeDef("$1 $2 $3"), "alpha beta gamma");
    expect(result.content).toBe("alpha beta gamma");
  });

  it("substitutes $@ with all args", () => {
    const result = expandPrompt(makeDef("features: $@"), "a b c");
    expect(result.content).toBe("features: a b c");
  });

  it("substitutes $ARGUMENTS with all args", () => {
    const result = expandPrompt(makeDef("features: $ARGUMENTS"), "a b c");
    expect(result.content).toBe("features: a b c");
  });

  it("respects quoted arguments", () => {
    const result = expandPrompt(makeDef("$1 $2"), 'hello "world with spaces"');
    expect(result.content).toBe("hello world with spaces");
  });

  it("respects single-quoted arguments", () => {
    const result = expandPrompt(makeDef("$1"), "'single quoted'");
    expect(result.content).toBe("single quoted");
  });

  it("returns empty string for missing positional arg", () => {
    const result = expandPrompt(makeDef("[$1][$2]"), "only-one");
    expect(result.content).toBe("[only-one][]");
  });
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: test descriptions document the syntax
const defaultValuesLabel = "expandPrompt default values (${N:-default})";
describe(defaultValuesLabel, () => {
  it("uses default when arg is missing", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${1:-fallback}"), "");
    expect(result.content).toBe("fallback");
  });

  it("uses arg value when present", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${1:-fallback}"), "actual");
    expect(result.content).toBe("actual");
  });

  it("uses default when arg is empty (space-padded)", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${1:-fallback}"), "  ");
    expect(result.content).toBe("fallback");
  });

  it("returns '0' for argument '0' instead of default", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${1:-five}"), "0");
    expect(result.content).toBe("0");
  });

  it("returns 'false' for argument 'false' instead of default", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${1:-yes}"), "false");
    expect(result.content).toBe("false");
  });
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: test descriptions document the syntax
const argSlicingLabel = "expandPrompt arg slicing (${@:N} and ${@:N:L})";
describe(argSlicingLabel, () => {
  it("slices from position N", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${@:2}"), "a b c d");
    expect(result.content).toBe("b c d");
  });

  it("slices from position N with length L", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${@:2:2}"), "a b c d");
    expect(result.content).toBe("b c");
  });

  it("handles start beyond args length", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: template content under test
    const result = expandPrompt(makeDef("${@:10}"), "a b");
    expect(result.content).toBe("");
  });
});

describe("expandPrompt block format", () => {
  it("wraps content in <prompt> block", () => {
    const result = expandPrompt(makeDef("Hello"), undefined);
    expect(result.block).toContain('<prompt name="test"');
    expect(result.block).toContain("Hello");
    expect(result.block).toContain("</prompt>");
  });

  it("includes file path in block", () => {
    const result = expandPrompt(makeDef("Hello"), undefined);
    expect(result.block).toContain('location="/fake/test.md"');
  });
});
