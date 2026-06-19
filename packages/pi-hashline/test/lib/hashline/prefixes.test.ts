import { describe, expect, it } from "vitest";

import {
  hashlineParseText,
  stripHashlinePrefixes,
  stripNewLinePrefixes,
} from "../../../src/lib/hashline/prefixes.js";

describe("stripHashlinePrefixes", () => {
  it("strips N: from every content line (happy path)", () => {
    const input = ["1:console.log('hello');", "2:console.log('world');", "3:"];
    const result = stripHashlinePrefixes(input);
    expect(result).toEqual([
      "console.log('hello');",
      "console.log('world');",
      "",
    ]);
  });

  it("strips ¶header line", () => {
    const input = ["¶src/foo.ts#A1B200", "1:line one", "2:line two"];
    const result = stripHashlinePrefixes(input);
    expect(result).toEqual(["line one", "line two"]);
  });

  it("leaves untouched when only some lines have N:", () => {
    const input = [
      "1:has prefix",
      "2:also has prefix",
      "no prefix here",
      "4:has prefix again",
    ];
    const result = stripHashlinePrefixes(input);
    expect(result).toBe(input); // same array reference = untouched
  });

  it("handles content starting with + (not a diff prefix)", () => {
    const input = ["1:+ not a diff", "2:regular"];
    const result = stripHashlinePrefixes(input);
    // The + is after the hashline prefix, so it stays
    expect(result).toEqual(["+ not a diff", "regular"]);
  });

  it("strips >>> indented prefixes (depth stripping)", () => {
    const input = [">>> 1:nested", ">>> 2:deep"];
    const result = stripHashlinePrefixes(input);
    expect(result).toEqual(["nested", "deep"]);
  });

  it("handles truncation notice lines", () => {
    const input = [
      "¶src/foo.ts#A1B200",
      "1:first line",
      "[Showing lines 1-10 of 50. Use :L20 to read more]",
      "2:second line",
    ];
    const result = stripHashlinePrefixes(input);
    expect(result).toEqual(["first line", "second line"]);
  });
});

describe("stripNewLinePrefixes", () => {
  it("strips + diff-style prefixes when >=50% lines have them", () => {
    const input = ["+line one", "+line two", "+line three", "no plus"];
    const result = stripNewLinePrefixes(input);
    // 3/4 lines have +, >= 50%, so strip +
    expect(result).toEqual(["line one", "line two", "line three", "no plus"]);
  });

  it("leaves untouched when no scheme recognized", () => {
    const input = ["just some", "regular text", "nothing special"];
    const result = stripNewLinePrefixes(input);
    expect(result).toBe(input); // same reference = untouched
  });
});

describe("hashlineParseText", () => {
  it("handles null/undefined", () => {
    expect(hashlineParseText(null)).toEqual([]);
    expect(hashlineParseText(undefined)).toEqual([]);
  });

  it("splits multiline string", () => {
    const input = "1:line one\n2:line two\n3:line three";
    const result = hashlineParseText(input);
    expect(result).toEqual(["line one", "line two", "line three"]);
  });
});
