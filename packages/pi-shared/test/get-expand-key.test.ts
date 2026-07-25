import { describe, expect, it } from "vitest";
import {
  getCollapseHint,
  getExpandHint,
  getExpandKey,
} from "../src/get-expand-key.js";
import { createMockTheme } from "./_helpers.js";

const theme = createMockTheme();

describe("getExpandKey", () => {
  it("returns a string", () => {
    // keyText("app.tools.expand") is not registered in test context.
    // The ?? fallback only triggers for null/undefined, not empty string.
    // In production (pi runtime) keyText returns the binding; in tests it returns "".
    expect(typeof getExpandKey()).toBe("string");
  });

  it("returns empty string when keybinding is not registered (test context)", () => {
    expect(getExpandKey()).toBe("");
  });
});

describe("getCollapseHint", () => {
  it("renders collapse hint with muted styling", () => {
    const hint = getCollapseHint(theme);
    // key is empty in test → " to collapse"
    expect(hint).toContain("[muted]");
    expect(hint).toContain("to collapse");
  });
});

describe("getExpandHint", () => {
  it("renders basic expand hint without remaining count", () => {
    const hint = getExpandHint(theme);
    expect(hint).toContain("[muted]");
    expect(hint).toContain("to expand");
  });

  it("renders expand hint with remaining line count", () => {
    const hint = getExpandHint(theme, 42);
    expect(hint).toContain("[muted]... (42 more lines, [/muted]");
    // key is empty → "[muted][/muted]"
    expect(hint).toContain("[muted] to expand)[/muted]");
  });

  it("renders expand hint with remaining = 1 (singular phrasing)", () => {
    const hint = getExpandHint(theme, 1);
    expect(hint).toContain("(1 more lines,");
  });

  it("does not render remaining count when 0", () => {
    // 0 is falsy but the check is `remaining > 0`, so should skip
    const hint = getExpandHint(theme, 0);
    expect(hint).not.toContain("more lines");
    expect(hint).toContain("to expand");
  });

  it("does not render remaining count when undefined", () => {
    const hint = getExpandHint(theme, undefined);
    expect(hint).not.toContain("more lines");
    expect(hint).toContain("to expand");
  });
});
