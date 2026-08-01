import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { researchSessionsDir } from "../src/lib/paths.js";
import {
  createResearchSession,
  getResearchSession,
  setResearchSessionChildPid,
  updateResearchSessionStatus,
} from "../src/lib/research-state.js";
import { withAgentDir } from "./_helpers.js";

const BASE = {
  task: "t",
  sessionFile: "x.jsonl",
  paneId: null,
  tmuxSession: null,
} as const;

describe("research session state writes", () => {
  it("applies childPid and status updates without leaving temp files", () => {
    withAgentDir((dir) => {
      createResearchSession({
        ...BASE,
        id: "abc-123",
        sessionFile: join(dir, "x.jsonl"),
        status: "running",
      });
      setResearchSessionChildPid("abc-123", 4242);
      updateResearchSessionStatus("abc-123", "completed");

      const state = getResearchSession("abc-123");
      expect(state?.childPid).toBe(4242);
      expect(state?.status).toBe("completed");
      // Atomic write leaves only the final file — no .tmp artifacts.
      expect(readdirSync(researchSessionsDir())).toEqual(["abc-123.json"]);
    });
  });

  it("child pid update preserves fields written by the parent", () => {
    withAgentDir((dir) => {
      createResearchSession({
        ...BASE,
        id: "abc-123",
        sessionFile: join(dir, "x.jsonl"),
        status: "completed",
      });
      setResearchSessionChildPid("abc-123", 4242);

      const state = getResearchSession("abc-123");
      expect(state?.status).toBe("completed");
      expect(state?.childPid).toBe(4242);
    });
  });
});
