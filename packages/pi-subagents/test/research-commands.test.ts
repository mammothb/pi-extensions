import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createResearchSession,
  getResearchSession,
} from "../src/lib/research-state.js";
import {
  closeResearchSessionById,
  sweepStaleResearchSessions,
} from "../src/research-commands.js";
import { withAgentDir } from "./_helpers.js";

describe("closeResearchSessionById", () => {
  it("is a no-op for unknown sessions", () => {
    withAgentDir(() => {
      expect(() => closeResearchSessionById("nope")).not.toThrow();
    });
  });
});

describe("sweepStaleResearchSessions", () => {
  it("cleans sessions whose tmux pane is gone", () => {
    withAgentDir((dir) => {
      createResearchSession({
        id: "dead-pane",
        task: "t",
        sessionFile: join(dir, "x.jsonl"),
        paneId: "%999",
        tmuxSession: "s",
        status: "running",
      });

      expect(sweepStaleResearchSessions()).toBe(1);
      expect(getResearchSession("dead-pane")).toBeNull();
    });
  });

  it("cleans no-tmux sessions whose child process is gone", () => {
    withAgentDir(() => {
      const deadPid = spawnSync("true").pid;
      createResearchSession({
        id: "dead-pid",
        task: "t",
        sessionFile: "/tmp/x.jsonl",
        paneId: null,
        tmuxSession: null,
        status: "running",
        childPid: deadPid,
      });

      expect(sweepStaleResearchSessions()).toBe(1);
      expect(getResearchSession("dead-pid")).toBeNull();
    });
  });

  it("keeps no-tmux sessions whose child process is alive", () => {
    withAgentDir(() => {
      createResearchSession({
        id: "live",
        task: "t",
        sessionFile: "/tmp/x.jsonl",
        paneId: null,
        tmuxSession: null,
        status: "running",
        childPid: process.pid,
      });

      expect(sweepStaleResearchSessions()).toBe(0);
      expect(getResearchSession("live")).not.toBeNull();
    });
  });

  it("leaves sessions with unknown liveness alone", () => {
    withAgentDir(() => {
      createResearchSession({
        id: "unknown",
        task: "t",
        sessionFile: "/tmp/x.jsonl",
        paneId: null,
        tmuxSession: null,
        status: "running",
      });

      expect(sweepStaleResearchSessions()).toBe(0);
      expect(getResearchSession("unknown")).not.toBeNull();
    });
  });

  it("skips completed sessions", () => {
    withAgentDir(() => {
      createResearchSession({
        id: "completed",
        task: "t",
        sessionFile: "/tmp/x.jsonl",
        paneId: "%999",
        tmuxSession: "s",
        status: "completed",
      });

      expect(sweepStaleResearchSessions()).toBe(0);
    });
  });
});
