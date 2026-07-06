import { describe, expect, it } from "vitest";
import { stripAnsi, stripAnsiFast } from "../src/lib/ansi";

describe("stripAnsi", () => {
  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("strips standard ANSI color codes", () => {
    expect(stripAnsi("\x1b[32mgreen\x1b[0m")).toBe("green");
  });

  it("strips ANSI bold/reset", () => {
    expect(stripAnsi("\x1b[1mbold\x1b[0m")).toBe("bold");
  });

  it("strips ANSI codes with multiple params", () => {
    expect(stripAnsi("\x1b[1;32mbold green\x1b[0m")).toBe("bold green");
  });

  it("strips ANSI codes in multiline text", () => {
    const input = "\x1b[32mline1\x1b[0m\n\x1b[31mline2\x1b[0m";
    expect(stripAnsi(input)).toBe("line1\nline2");
  });

  it("handles text with no ANSI codes", () => {
    expect(stripAnsi("plain text\nwith newlines")).toBe(
      "plain text\nwith newlines",
    );
  });

  it("strips OSC sequences (terminal titles)", () => {
    // OSC 0 is common for setting window title
    expect(stripAnsi("\x1b]0;title\x07text")).toBe("text");
  });

  it("strips OSC sequences with ST terminator", () => {
    expect(stripAnsi("\x1b]0;title\x1b\\text")).toBe("text");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips ANSI cursor movement codes", () => {
    // Cursor up 1, clear line
    expect(stripAnsi("\x1b[1A\x1b[2Ktext")).toBe("text");
  });

  it("preserves non-ANSI \x1b bytes in isolation (no bracket after)", () => {
    // ESC not followed by [ or ] is left alone
    const input = "\x1bXtext"; // ESC X is not a recognized pattern
    expect(stripAnsi(input)).toBe("\x1bXtext");
  });
});

describe("stripAnsiFast", () => {
  it("returns text unchanged when no ESC present", () => {
    const text = "plain text without escape";
    expect(stripAnsiFast(text)).toBe(text);
  });

  it("delegates to stripAnsi when ESC present", () => {
    expect(stripAnsiFast("\x1b[32mgreen\x1b[0m")).toBe("green");
  });

  it("handles empty string", () => {
    expect(stripAnsiFast("")).toBe("");
  });
});
