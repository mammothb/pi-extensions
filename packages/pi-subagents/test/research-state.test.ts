import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  researchSessionStatePath,
  researchSessionsDir,
} from "../src/lib/paths.js";
import {
  createResearchSession,
  getResearchSession,
  listResearchSessions,
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

  it("getResearchSession returns null for a corrupted state file", () => {
    withAgentDir((dir) => {
      createResearchSession({
        ...BASE,
        id: "abc-123",
        sessionFile: join(dir, "x.jsonl"),
        status: "running",
      });
      writeFileSync(researchSessionStatePath("abc-123"), "{ broken", "utf-8");
      expect(getResearchSession("abc-123")).toBeNull();
    });
  });

  it("listResearchSessions returns [] when the sessions dir is missing", () => {
    withAgentDir(() => {
      expect(listResearchSessions()).toEqual([]);
    });
  });

  it("listResearchSessions skips unparseable state files", () => {
    withAgentDir((dir) => {
      createResearchSession({
        ...BASE,
        id: "abc-123",
        sessionFile: join(dir, "x.jsonl"),
        status: "running",
      });
      writeFileSync(researchSessionStatePath("abc-123"), "{ broken", "utf-8");
      expect(listResearchSessions()).toEqual([]);
    });
  });

  it("setResearchSessionChildPid is a no-op for unknown ids", () => {
    withAgentDir(() => {
      expect(() => setResearchSessionChildPid("nope", 1)).not.toThrow();
    });
  });

  it("listResearchSessions sorts by startedAt descending", () => {
    withAgentDir(() => {
      mkdirSync(researchSessionsDir(), { recursive: true });
      const base = {
        task: "t",
        sessionFile: "x.jsonl",
        paneId: null,
        tmuxSession: null,
        status: "running" as const,
      };
      writeFileSync(
        researchSessionStatePath("older"),
        JSON.stringify({
          ...base,
          id: "older",
          startedAt: "2020-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );
      writeFileSync(
        researchSessionStatePath("newer"),
        JSON.stringify({
          ...base,
          id: "newer",
          startedAt: "2021-01-01T00:00:00.000Z",
        }),
        "utf-8",
      );

      expect(listResearchSessions().map((s) => s.id)).toEqual([
        "newer",
        "older",
      ]);
    });
  });
});
