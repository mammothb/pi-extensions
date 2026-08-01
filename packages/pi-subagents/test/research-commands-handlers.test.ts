import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { researchScriptsDir } from "../src/lib/paths.js";
import {
  createResearchSession,
  getResearchSession,
  listResearchSessions,
  updateResearchSessionStatus,
} from "../src/lib/research-state.js";
import {
  createResearchCloseHandler,
  createResearchHandler,
  createResearchReportHandler,
} from "../src/research-commands.js";
import { withAgentDir } from "./_helpers.js";

// Mock the tmux module so the /rsh handler's pane flow runs without a
// tmux server, and failures are controllable.
vi.mock("../src/lib/tmux.js", () => ({
  tmuxActive: vi.fn(() => false),
  tmuxGetSessionName: vi.fn(() => "testsession"),
  tmuxSplitWindow: vi.fn(() => "%1"),
  tmuxSendKeys: vi.fn(),
  tmuxSelectPane: vi.fn(),
  tmuxKillPane: vi.fn(),
  tmuxPaneAlive: vi.fn(() => true),
}));

import * as tmux from "../src/lib/tmux.js";

const tmuxMock = vi.mocked(tmux);

// Reset tmux mocks to their defaults before every test so call history and
// per-test implementations don't leak across tests.
beforeEach(() => {
  tmuxMock.tmuxActive.mockReturnValue(false);
  tmuxMock.tmuxGetSessionName.mockReturnValue("testsession");
  tmuxMock.tmuxSplitWindow.mockReturnValue("%1");
  tmuxMock.tmuxSendKeys.mockReset();
  tmuxMock.tmuxSelectPane.mockReset();
  tmuxMock.tmuxKillPane.mockReset();
  tmuxMock.tmuxPaneAlive.mockReturnValue(true);
});

const FULL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Write a minimal parent session file with header + message entries. */
function writeParentSession(dir: string, texts: string[]): string {
  const path = join(dir, "parent.jsonl");
  const header = {
    type: "session",
    version: 3,
    id: "parent-session",
    timestamp: new Date().toISOString(),
    cwd: dir,
  };
  const entries = texts.map((text, i) => ({
    type: "message",
    id: `entry${i}`,
    parentId: i === 0 ? null : `entry${i - 1}`,
    timestamp: new Date().toISOString(),
    message: {
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text }],
    },
  }));
  writeFileSync(
    path,
    `${[JSON.stringify(header), ...entries.map((e) => JSON.stringify(e))].join(
      "\n",
    )}\n`,
    "utf-8",
  );
  return path;
}

function makeCtx(dir: string, parentSessionFile: string | null) {
  const notify = vi.fn();
  const ctx = {
    cwd: dir,
    model: undefined,
    sessionManager: { getSessionFile: () => parentSessionFile },
    ui: { notify },
  } as unknown as ExtensionCommandContext;
  return { ctx, notify };
}

function makePi() {
  return { sendMessage: vi.fn() } as unknown as ExtensionAPI;
}

function makeRunningSession(dir: string, id: string, task: string): void {
  createResearchSession({
    id,
    task,
    sessionFile: join(dir, `${id}.jsonl`),
    paneId: null,
    tmuxSession: null,
    status: "running",
  });
}

describe("createResearchHandler (/rsh)", () => {
  it("rejects an empty task", () => {
    withAgentDir((dir) => {
      const { ctx, notify } = makeCtx(dir, join(dir, "parent.jsonl"));
      const handler = createResearchHandler(makePi());
      void handler("  ", ctx);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Usage:"),
        "error",
      );
    });
  });

  it("rejects when there is no active session file", () => {
    withAgentDir((dir) => {
      const { ctx, notify } = makeCtx(dir, null);
      const handler = createResearchHandler(makePi());
      void handler("research this", ctx);
      expect(notify).toHaveBeenCalledWith(
        "No active session to fork from.",
        "error",
      );
    });
  });

  it("notifies when the parent session cannot be forked", () => {
    withAgentDir((dir) => {
      const broken = join(dir, "broken.jsonl");
      writeFileSync(broken, "{ not json", "utf-8");
      const { ctx, notify } = makeCtx(dir, broken);
      const handler = createResearchHandler(makePi());
      void handler("research this", ctx);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to fork session"),
        "error",
      );
    });
  });

  it("notifies when the tmux pane cannot be created", () => {
    withAgentDir((dir) => {
      tmuxMock.tmuxActive.mockReturnValue(true);
      tmuxMock.tmuxSplitWindow.mockImplementationOnce(() => {
        throw new Error("no server");
      });
      const parent = writeParentSession(dir, ["hello"]);
      const { ctx, notify } = makeCtx(dir, parent);
      const handler = createResearchHandler(makePi());
      void handler("research widgets", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create tmux pane"),
        "error",
      );
      expect(listResearchSessions()).toEqual([]);
    });
  });

  it("starts a research session without tmux (manual fallback)", () => {
    withAgentDir((dir) => {
      const parent = writeParentSession(dir, ["hello", "hi there"]);
      const pi = makePi();
      const { ctx, notify } = makeCtx(dir, parent);
      const handler = createResearchHandler(pi);
      void handler("research widgets", ctx);

      const sessions = listResearchSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.status).toBe("running");
      expect(sessions[0]!.paneId).toBeNull();
      expect(sessions[0]!.id).toMatch(FULL_UUID);
      expect(notify).toHaveBeenCalledWith(
        "No tmux session detected.",
        "warning",
      );
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "research_start" }),
      );
      // Launch script was written for the manual fallback
      expect(
        existsSync(join(researchScriptsDir(), `${sessions[0]!.id}.sh`)),
      ).toBe(true);
    });
  });

  it("includes the model id in the launch command when set", () => {
    withAgentDir((dir) => {
      const parent = writeParentSession(dir, ["hello"]);
      const pi = makePi();
      const notify = vi.fn();
      const ctx = {
        cwd: dir,
        model: { provider: "anthropic", id: "claude-x" },
        sessionManager: { getSessionFile: () => parent },
        ui: { notify },
      } as unknown as ExtensionCommandContext;
      const handler = createResearchHandler(pi);
      void handler("research", ctx);

      const script = readFileSync(
        join(researchScriptsDir(), `${listResearchSessions()[0]!.id}.sh`),
        "utf-8",
      );
      expect(script).toContain("anthropic/claude-x");
    });
  });

  it("starts a session in a tmux pane and focuses it", () => {
    withAgentDir((dir) => {
      tmuxMock.tmuxActive.mockReturnValue(true);
      tmuxMock.tmuxSplitWindow.mockReturnValue("%7");
      const parent = writeParentSession(dir, ["hello", "hi there"]);
      const pi = makePi();
      const { ctx } = makeCtx(dir, parent);
      const handler = createResearchHandler(pi);
      void handler("research widgets", ctx);

      expect(tmuxMock.tmuxSendKeys).toHaveBeenCalledWith(
        "%7",
        expect.stringContaining("bash "),
      );
      expect(tmuxMock.tmuxSelectPane).toHaveBeenCalledWith("%7");
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "research_start" }),
      );
      const sessions = listResearchSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.paneId).toBe("%7");
      expect(sessions[0]!.id).toMatch(FULL_UUID);
    });
  });

  it("rolls back the session when starting the child fails", () => {
    withAgentDir((dir) => {
      tmuxMock.tmuxActive.mockReturnValue(true);
      tmuxMock.tmuxSplitWindow.mockReturnValue("%1");
      tmuxMock.tmuxSendKeys.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const parent = writeParentSession(dir, ["hello"]);
      const pi = makePi();
      const { ctx, notify } = makeCtx(dir, parent);
      const handler = createResearchHandler(pi);
      void handler("research widgets", ctx);

      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to start research session"),
        "error",
      );
      expect(listResearchSessions()).toEqual([]);
      expect(tmuxMock.tmuxKillPane).toHaveBeenCalledWith("%1");
    });
  });

  it("swallows focus failures after a successful start", () => {
    withAgentDir((dir) => {
      tmuxMock.tmuxActive.mockReturnValue(true);
      tmuxMock.tmuxSelectPane.mockImplementationOnce(() => {
        throw new Error("focus failed");
      });
      const parent = writeParentSession(dir, ["hello"]);
      const pi = makePi();
      const { ctx } = makeCtx(dir, parent);
      const handler = createResearchHandler(pi);
      void handler("research widgets", ctx);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ customType: "research_start" }),
      );
      expect(listResearchSessions()).toHaveLength(1);
    });
  });

  it("skips focusing when focusOnStart is disabled", () => {
    withAgentDir((dir) => {
      tmuxMock.tmuxActive.mockReturnValue(true);
      const agentDir = process.env.PI_CODING_AGENT_DIR;
      if (!agentDir) {
        throw new Error("expected agent dir");
      }
      writeFileSync(
        join(agentDir, "pi-subagents.json"),
        JSON.stringify({ focusOnStart: false }),
        "utf-8",
      );

      const parent = writeParentSession(dir, ["hello"]);
      const pi = makePi();
      const { ctx } = makeCtx(dir, parent);
      const handler = createResearchHandler(pi);
      void handler("research widgets", ctx);

      expect(tmuxMock.tmuxSelectPane).not.toHaveBeenCalled();
    });
  });
});

describe("createResearchCloseHandler (/rsh-close)", () => {
  it("notifies when the id is unknown", () => {
    withAgentDir((dir) => {
      const { ctx, notify } = makeCtx(dir, null);
      const handler = createResearchCloseHandler(makePi());
      void handler("unknown-id", ctx);
      expect(notify).toHaveBeenCalledWith(
        'No research session found with id "unknown-id".',
        "error",
      );
    });
  });

  it("notifies when a prefix is ambiguous", () => {
    withAgentDir((dir) => {
      const pi = makePi();
      const { ctx, notify } = makeCtx(dir, null);
      const handler = createResearchCloseHandler(pi);
      makeRunningSession(dir, "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "t1");
      makeRunningSession(dir, "11111111-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "t2");

      void handler("11111111", ctx);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Multiple sessions match"),
        "error",
      );
      expect(pi.sendMessage).not.toHaveBeenCalled();
    });
  });

  it("closes a session by unique prefix and sends the close message", () => {
    withAgentDir((dir) => {
      const pi = makePi();
      const { ctx } = makeCtx(dir, null);
      const handler = createResearchCloseHandler(pi);
      makeRunningSession(
        dir,
        "22222222-cccc-4ccc-8ccc-cccccccccccc",
        "close me",
      );

      void handler("22222222", ctx);
      expect(
        getResearchSession("22222222-cccc-4ccc-8ccc-cccccccccccc"),
      ).toBeNull();
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "research_close",
          content: "Closed research session: close me",
        }),
      );
    });
  });

  it("lists active sessions when no id is given", () => {
    withAgentDir((dir) => {
      const { ctx, notify } = makeCtx(dir, null);
      const handler = createResearchCloseHandler(makePi());
      void handler("", ctx);
      expect(notify).toHaveBeenCalledWith(
        "No active research sessions.",
        "info",
      );
    });
  });

  it("lists running sessions with their short ids", () => {
    withAgentDir((dir) => {
      makeRunningSession(
        dir,
        "33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "task one",
      );
      makeRunningSession(
        dir,
        "44444444-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "task two",
      );
      // Mark the second session completed so only the first is listed
      updateResearchSessionStatus(
        "44444444-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "completed",
      );

      const { ctx, notify } = makeCtx(dir, null);
      const handler = createResearchCloseHandler(makePi());
      void handler("", ctx);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("33333333  task one"),
        "info",
      );
      expect(notify).not.toHaveBeenCalledWith(
        expect.stringContaining("44444444"),
        "info",
      );
    });
  });
});

describe("createResearchReportHandler (/rsh-report)", () => {
  const prevEnv: Record<string, string | undefined> = {};

  function setReportEnv(id: string | undefined, task: string | undefined) {
    if (id === undefined) {
      delete process.env.PI_RSH_SESSION_ID;
    } else {
      process.env.PI_RSH_SESSION_ID = id;
    }
    if (task === undefined) {
      delete process.env.PI_RSH_TASK;
    } else {
      process.env.PI_RSH_TASK = task;
    }
  }

  beforeEach(() => {
    prevEnv.PI_RSH_SESSION_ID = process.env.PI_RSH_SESSION_ID;
    prevEnv.PI_RSH_TASK = process.env.PI_RSH_TASK;
  });

  afterEach(() => {
    if (prevEnv.PI_RSH_SESSION_ID === undefined) {
      delete process.env.PI_RSH_SESSION_ID;
    } else {
      process.env.PI_RSH_SESSION_ID = prevEnv.PI_RSH_SESSION_ID;
    }
    if (prevEnv.PI_RSH_TASK === undefined) {
      delete process.env.PI_RSH_TASK;
    } else {
      process.env.PI_RSH_TASK = prevEnv.PI_RSH_TASK;
    }
  });

  it("rejects when not in a research session", () => {
    withAgentDir((dir) => {
      setReportEnv(undefined, "t");
      const { ctx, notify } = makeCtx(dir, null);
      const handler = createResearchReportHandler({ reportBack: vi.fn() });
      void handler("", ctx);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Not in a research session"),
        "error",
      );
    });
  });

  it("rejects when there is no session file", () => {
    withAgentDir((dir) => {
      setReportEnv("abc-123", "t");
      const { ctx, notify } = makeCtx(dir, null);
      const handler = createResearchReportHandler({ reportBack: vi.fn() });
      void handler("", ctx);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("No session file"),
        "error",
      );
    });
  });

  it("notifies when the session file cannot be opened", () => {
    withAgentDir((dir) => {
      setReportEnv("abc-123", "t");
      const broken = join(dir, "broken.jsonl");
      writeFileSync(broken, "{ not json", "utf-8");
      const { ctx, notify } = makeCtx(dir, broken);
      const handler = createResearchReportHandler({ reportBack: vi.fn() });
      void handler("", ctx);
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to extract report"),
        "error",
      );
    });
  });

  it("sends the extracted output back to the parent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-subagents-rpt-"));
    setReportEnv("abc-123", "research widgets");
    try {
      const sessionFile = writeParentSession(dir, ["question", "the answer"]);
      const reportBack = vi.fn();
      const notify = vi.fn();
      const ctx = {
        cwd: dir,
        sessionManager: { getSessionFile: () => sessionFile },
        ui: { notify },
      } as unknown as ExtensionCommandContext;

      await createResearchReportHandler({ reportBack })("", ctx);

      expect(reportBack).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "abc-123",
          task: "research widgets",
          output: "the answer",
        }),
      );
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining("Report sent"),
        "info",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
