import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expandTilde } from "../src/expand-tilde.js";

describe("expandTilde", () => {
  it("expands ~/ to home directory", () => {
    const result = expandTilde("~/Documents");
    expect(result).toBe(join(homedir(), "Documents"));
  });

  it("expands bare ~ to home directory", () => {
    const result = expandTilde("~");
    expect(result).toBe(homedir());
  });

  it("does not expand ~ in middle of path", () => {
    const result = expandTilde("/home/~user/docs");
    expect(result).toBe("/home/~user/docs");
  });

  it("does not expand ~otheruser (bash-style user home)", () => {
    const input = "~otheruser/docs";
    const result = expandTilde(input);
    expect(result).toBe(input);
  });

  it("passes through absolute path unchanged", () => {
    expect(expandTilde("/usr/bin/node")).toBe("/usr/bin/node");
  });

  it("passes through relative path unchanged", () => {
    expect(expandTilde("./config.json")).toBe("./config.json");
  });

  it("expands ~/ alone to home directory", () => {
    const result = expandTilde("~/");
    // join(homedir(), "/") → e.g. "/home/mmb/"
    expect(result).toBe(join(homedir(), "/"));
  });
});
