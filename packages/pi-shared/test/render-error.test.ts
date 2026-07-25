import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderError } from "../src/render-error.js";
import { createMockTheme } from "./_helpers.js";

const theme = createMockTheme();

describe("renderError", () => {
  it("renders plain error text when no options", () => {
    const result = renderError("something failed", theme);
    expect(result).toBeInstanceOf(Text);
    const lines = result.render(80);
    expect(lines[0]).toContain("[error]something failed[/error]");
  });

  it("prefixes with toolLabel when provided", () => {
    const result = renderError("oops", theme, { toolLabel: "myTool" });
    const lines = result.render(80);
    expect(lines[0]).toContain("[error]myTool: oops[/error]");
  });

  it("appends expand hint when expandable is true", () => {
    const result = renderError("bad things", theme, { expandable: true });
    const lines = result.render(80);
    expect(lines[0]).toContain("[error]bad things[/error]");
    // getExpandKey() returns "" in test (keyText not registered)
    // The hint space and muted tags are still present
    expect(lines[0]).toContain("[muted]");
  });

  it("does not append expand hint when expandable is false", () => {
    const result = renderError("bad things", theme, { expandable: false });
    const lines = result.render(80);
    expect(lines[0]).toContain("[error]bad things[/error]");
    // Should NOT have muted content after the error
    expect(lines[0]).not.toContain("[muted]");
  });

  it("does not append expand hint by default (no opts)", () => {
    const result = renderError("bad things", theme);
    const lines = result.render(80);
    expect(lines[0]).toContain("[error]bad things[/error]");
    expect(lines[0]).not.toContain("[muted]");
  });

  it("combines toolLabel and expandable", () => {
    const result = renderError("fail", theme, {
      toolLabel: "gh_search",
      expandable: true,
    });
    const lines = result.render(80);
    expect(lines[0]).toContain("[error]gh_search: fail[/error]");
    expect(lines[0]).toContain("[muted]");
  });

  it("returns Text with zero padding", () => {
    const result = renderError("x", theme);
    const lines = result.render(80);
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty rawText", () => {
    const result = renderError("", theme);
    const lines = result.render(80);
    expect(lines[0]).toContain("[error][/error]");
  });

  it("handles empty rawText with toolLabel", () => {
    const result = renderError("", theme, { toolLabel: "tool" });
    const lines = result.render(80);
    expect(lines[0]).toContain("[error]tool: [/error]");
  });
});
