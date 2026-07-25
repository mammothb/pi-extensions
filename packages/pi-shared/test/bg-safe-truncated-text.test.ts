import { describe, expect, it } from "vitest";
import { BgSafeTruncatedText } from "../src/bg-safe-truncated-text.js";

const ESC = "\x1b";

describe("BgSafeTruncatedText", () => {
  it("renders short text without truncation", () => {
    const component = new BgSafeTruncatedText("hello", 0, 0);
    const lines = component.render(80);
    expect(lines.length).toBe(1);
    // Text component pads with spaces to fill width
    expect(lines[0]).toContain("hello");
  });

  it("renders long text with truncation using \\x1b[39m (not \\x1b[0m)", () => {
    const longText = "a".repeat(200);
    const component = new BgSafeTruncatedText(longText, 0, 0);
    const lines = component.render(20);

    // Should be truncated — fewer than 200 chars due to 20-char width
    const joined = lines.join("");
    expect(joined.length).toBeLessThan(longText.length);

    // Must NOT contain full reset (ESC[0m)
    expect(joined).not.toContain(`${ESC}[0m`);

    // Should contain foreground-only reset (ESC[39m)
    expect(joined).toContain(`${ESC}[39m`);
  });

  it("does not inject reset codes when text fits", () => {
    const component = new BgSafeTruncatedText("short", 0, 0);
    const lines = component.render(80);
    const joined = lines.join("");
    expect(joined).not.toContain(`${ESC}[39m`);
    expect(joined).not.toContain(`${ESC}[0m`);
  });

  it("handles empty text", () => {
    const component = new BgSafeTruncatedText("", 0, 0);
    const lines = component.render(80);
    expect(lines.length).toBeGreaterThanOrEqual(0);
  });

  it("replaces ALL occurrences of ESC[0m with ESC[39m", () => {
    // Text that might trigger multiple truncations
    const veryLong = "x".repeat(1000);
    const component = new BgSafeTruncatedText(veryLong, 1, 1);
    const lines = component.render(5);
    const joined = lines.join("");
    // Must not contain any full resets
    expect(joined).not.toContain(`${ESC}[0m`);
  });
});
