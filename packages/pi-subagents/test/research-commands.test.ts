import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  researchScriptLogPath,
  researchScriptPath,
  researchScriptsDir,
} from "../src/lib/paths.js";
import {
  createResearchSession,
  getResearchSession,
  type ResearchSessionState,
} from "../src/lib/research-state.js";
import {
  closeResearchSessionById,
  resolveResearchSession,
  sweepStaleResearchSessions,
} from "../src/research-commands.js";
import { withAgentDir } from "./_helpers.js";

describe("closeResearchSessionById", () => {
  it("is a no-op for unknown sessions", () => {
    withAgentDir(() => {
      expect(() => closeResearchSessionById("nope")).not.toThrow();
    });
  });

  it("removes the session file, launch script, and stderr log", () => {
    withAgentDir((dir) => {
      createResearchSession({
        id: "abc-123",
        task: "t",
        sessionFile: join(dir, "x.jsonl"),
        paneId: null,
        tmuxSession: null,
        status: "running",
      });
      const sessionFile = join(dir, "x.jsonl");
      writeFileSync(sessionFile, "{}", "utf-8");
      mkdirSync(researchScriptsDir(), { recursive: true });
      writeFileSync(researchScriptPath("abc-123"), "#!/bin/bash\n", "utf-8");
      writeFileSync(researchScriptLogPath("abc-123"), "log\n", "utf-8");

      closeResearchSessionById("abc-123");

      expect(existsSync(sessionFile)).toBe(false);
      expect(existsSync(researchScriptPath("abc-123"))).toBe(false);
      expect(existsSync(researchScriptLogPath("abc-123"))).toBe(false);
      expect(getResearchSession("abc-123")).toBeNull();
    });
  });
});

describe("resolveResearchSession", () => {
  const sessions = [
    { id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { id: "11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { id: "22222222-cccc-4ccc-8ccc-cccccccccccc" },
  ] as unknown as ResearchSessionState[];

  it("resolves an exact id", () => {
    const id = "22222222-cccc-4ccc-8ccc-cccccccccccc";
    const resolved = resolveResearchSession(sessions, id);
    if (resolved === "ambiguous" || resolved === null) {
      throw new Error("expected a session");
    }
    expect(resolved.id).toBe(id);
  });

  it("resolves a prefix that uniquely identifies one session", () => {
    const resolved = resolveResearchSession(sessions, "22222222");
    if (resolved === "ambiguous" || resolved === null) {
      throw new Error("expected a session");
    }
    expect(resolved.id).toBe("22222222-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("rejects an ambiguous prefix", () => {
    expect(resolveResearchSession(sessions, "11111111")).toBe("ambiguous");
  });

  it("returns null for unknown ids and prefixes", () => {
    expect(resolveResearchSession(sessions, "99999999")).toBeNull();
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
    withAgentDir((dir) => {
      // Far above any platform's pid_max (Linux ~4.2M, macOS/BSD 99999),
      // so kill(pid, 0) always ESRCHs — never a live process.
      const deadPid = 99_999_999;
      expect(deadPid).toBeDefined();
      createResearchSession({
        id: "dead-pid",
        task: "t",
        sessionFile: join(dir, "x.jsonl"),
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
    withAgentDir((dir) => {
      createResearchSession({
        id: "live",
        task: "t",
        sessionFile: join(dir, "x.jsonl"),
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
    withAgentDir((dir) => {
      createResearchSession({
        id: "unknown",
        task: "t",
        sessionFile: join(dir, "x.jsonl"),
        paneId: null,
        tmuxSession: null,
        status: "running",
      });

      expect(sweepStaleResearchSessions()).toBe(0);
      expect(getResearchSession("unknown")).not.toBeNull();
    });
  });

  it("skips completed sessions", () => {
    withAgentDir((dir) => {
      createResearchSession({
        id: "completed",
        task: "t",
        sessionFile: join(dir, "x.jsonl"),
        paneId: "%999",
        tmuxSession: "s",
        status: "completed",
      });

      expect(sweepStaleResearchSessions()).toBe(0);
    });
  });
});
