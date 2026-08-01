import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Fixed uuid whose 8-char prefix collides with the seeded entry id, forcing
// generateEntryId's 100-collision fallback to return the full uuid.
vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "deadbeef-1234-4abc-8def-000000000000"),
}));

import { appendBoundaryEntry } from "../src/lib/session.js";
import { withAgentDir } from "./_helpers.js";

describe("generateEntryId collision fallback", () => {
  it("falls back to a full uuid after exhausting 8-char ids", () => {
    withAgentDir((dir) => {
      const path = join(dir, "s.jsonl");
      writeFileSync(
        path,
        `${[
          JSON.stringify({
            type: "session",
            version: 3,
            id: "s1",
            timestamp: "t",
            cwd: dir,
          }),
          JSON.stringify({
            type: "message",
            id: "deadbeef",
            parentId: null,
            timestamp: "t",
            message: { role: "user", content: [{ type: "text", text: "x" }] },
          }),
        ].join("\n")}\n`,
        "utf-8",
      );

      const id = appendBoundaryEntry(path, "test");
      expect(id).toBe("deadbeef-1234-4abc-8def-000000000000");
      const appended = readFileSync(path, "utf8").trim().split("\n").pop();
      if (!appended) {
        throw new Error("expected appended entry");
      }
      expect(JSON.parse(appended).id).toBe(id);
    });
  });
});
