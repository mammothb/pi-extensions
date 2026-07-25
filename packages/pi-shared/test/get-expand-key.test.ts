import { describe, expect, it } from "vitest";
import {
  getCollapseHint,
  getExpandHint,
  getExpandKey,
} from "../src/get-expand-key.js";
import { createMockTheme } from "./_helpers.js";

const theme = createMockTheme();

describe("getExpandKey", () => {
  it("returns a non-empty string", () => {
    expect(getExpandKey().length).toBeGreaterThan(0);
  });

  it('returns "Ctrl+O" fallback when keybinding is not registered (test context)', () => {
    expect(getExpandKey()).toBe("Ctrl+O");
  });
});

describe("getCollapseHint", () => {
  it("renders collapse hint with the expand key", () => {
    const hint = getCollapseHint(theme);
    expect(hint).toBe("[muted]Ctrl+O to collapse[/muted]");
  });
});

describe("getExpandHint", () => {
  it("renders basic expand hint without remaining count", () => {
    const hint = getExpandHint(theme);
    expect(hint).toBe("[muted]Ctrl+O to expand[/muted]");
  });

  it("renders expand hint with remaining line count", () => {
    const hint = getExpandHint(theme, 42);
    expect(hint).toContain("[muted]... (42 more lines, [/muted]");
    expect(hint).toContain("[muted]Ctrl+O[/muted]");
    expect(hint).toContain("[muted] to expand)[/muted]");
  });

  it("renders expand hint with remaining = 1 (singular phrasing)", () => {
    const hint = getExpandHint(theme, 1);
    expect(hint).toContain("(1 more line,");
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
