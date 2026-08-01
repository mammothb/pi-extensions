import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withAgentDir } from "./_helpers.js";

describe("withAgentDir", () => {
  it("rejects asynchronous callbacks with a clear error", () => {
    expect(() => withAgentDir(async () => {})).toThrow(
      /does not support asynchronous callbacks/,
    );
  });

  it("restores the env and removes the temp dir after sync callbacks", () => {
    const before = process.env.PI_CODING_AGENT_DIR;
    withAgentDir((dir) => {
      expect(process.env.PI_CODING_AGENT_DIR).toBe(dir);
      expect(existsSync(dir)).toBe(true);
    });
    expect(process.env.PI_CODING_AGENT_DIR).toBe(before);
  });
});
