import { describe, expect, it } from "vitest";
import { scanTokens, stripTokens } from "../src/token-scanner.js";

describe("scanTokens", () => {
  it("detects #skill:name at start of text", () => {
    const { tokens } = scanTokens("#skill:react");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.namespace).toBe("skill");
    expect(tokens[0]!.name).toBe("react");
  });

  it("detects #prompt:name at start of text", () => {
    const { tokens } = scanTokens("#prompt:plan my-feature");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.namespace).toBe("prompt");
    expect(tokens[0]!.name).toBe("plan");
  });

  it("detects # tokens mid-text after whitespace", () => {
    const { tokens } = scanTokens("@docs/PROPOSAL.md #prompt:plan my-feature");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.name).toBe("plan");
  });

  it("detects multiple # tokens", () => {
    const { tokens } = scanTokens(
      "#skill:react check @file #prompt:greet hello",
    );
    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.namespace).toBe("skill");
    expect(tokens[1]!.namespace).toBe("prompt");
  });

  it("does not match /-prefixed tokens", () => {
    const { tokens } = scanTokens("/skill:react or /prompt:plan");
    expect(tokens).toHaveLength(0);
  });

  it("ignores tokens not preceded by whitespace", () => {
    const { tokens } = scanTokens("foo#skill:bar or http://prompt:x");
    expect(tokens).toHaveLength(0);
  });

  it("handles skill: with hyphens and dots", () => {
    const { tokens } = scanTokens("#skill:my-skill.name test");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.name).toBe("my-skill.name");
  });

  it("returns empty for no matches", () => {
    const { tokens } = scanTokens("regular text without triggers");
    expect(tokens).toHaveLength(0);
  });
});

describe("stripTokens", () => {
  it("strips a single token", () => {
    const text = "#prompt:plan hello world";
    const { tokens } = scanTokens(text);
    const result = stripTokens(text, tokens);
    expect(result).toBe("hello world");
  });

  it("strips multiple tokens", () => {
    const text = "#skill:react fix the #prompt:plan bug";
    const { tokens } = scanTokens(text);
    const result = stripTokens(text, tokens);
    expect(result).toBe("fix the bug");
  });

  it("preserves text between tokens", () => {
    const text = "before #skill:x middle #prompt:y after";
    const { tokens } = scanTokens(text);
    const result = stripTokens(text, tokens);
    expect(result).toBe("before middle after");
  });

  it("handles text with no tokens", () => {
    const { tokens } = scanTokens("no triggers here");
    expect(tokens).toHaveLength(0);
    const result = stripTokens("no triggers here", tokens);
    expect(result).toBe("no triggers here");
  });
});
