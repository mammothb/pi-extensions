import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  formatCompactionStats,
  getLastCompactionStats,
  registerBeforeCompactHook,
} from "../src/hooks/before-compact";

let tmpDir: string;
let CONFIG_PATH: string;
const DEBUG_PATH = "/tmp/mm-compact-debug.json";

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mm-compact-test-"));
  CONFIG_PATH = join(tmpDir, "pi-memory.json");
  process.env.PI_MEMORY_CONFIG_PATH = CONFIG_PATH;
});

afterAll(() => {
  delete process.env.PI_MEMORY_CONFIG_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

// Minimal ExtensionAPI stub
function createMockPi() {
  let beforeHandler: ((event: any, ctx: any) => any) | undefined;
  let compactHandler: ((event: any, ctx: any) => any) | undefined;
  const notifyCalls: Array<{ msg: string; level: string }> = [];
  const userMessages: Array<string | unknown[]> = [];
  const ctx = {
    hasUI: true,
    ui: {
      notify: (msg: string, level: string) => {
        notifyCalls.push({ msg, level });
      },
    },
  };
  return {
    pi: {
      on: (eventName: string, h: (e: any, c: any) => any) => {
        if (eventName === "session_before_compact") {
          beforeHandler = h;
        }
        if (eventName === "session_compact") {
          compactHandler = h;
        }
      },
      sendUserMessage: (content: string | unknown[]) => {
        userMessages.push(content);
      },
    } as any,
    invokeBefore: (event: any) => beforeHandler!(event, ctx),
    invokeCompact: (event: any) => compactHandler!(event, ctx),
    notifyCalls,
    userMessages,
  };
}

function setConfig(cfg: Record<string, unknown>) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg));
}

function makeEvent(
  branchEntries: any[],
  customInstructions?: string,
  eventContext: Record<string, unknown> = {},
) {
  return {
    type: "session_before_compact",
    customInstructions,
    branchEntries,
    preparation: {
      previousSummary: undefined,
      fileOps: { read: [], written: [], edited: [] },
      tokensBefore: 1000,
    },
    signal: new AbortController().signal,
    ...eventContext,
  };
}

const msg = (
  id: string,
  role: "user" | "assistant" | "toolResult",
  content = "x",
) => ({
  id,
  type: "message",
  message: { role, content },
});
const _comp = (id: string, firstKeptEntryId?: string) => ({
  id,
  type: "compaction",
  firstKeptEntryId,
});

describe("registerBeforeCompactHook: cancel paths", () => {
  beforeEach(() => {
    if (existsSync(DEBUG_PATH)) {
      unlinkSync(DEBUG_PATH);
    }
  });
  afterEach(() => {
    if (existsSync(CONFIG_PATH)) {
      unlinkSync(CONFIG_PATH);
    }
    if (existsSync(DEBUG_PATH)) {
      unlinkSync(DEBUG_PATH);
    }
  });

  it("/mm-compact with too few live messages cancels and notifies warning", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore, notifyCalls } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [msg("m1", "user"), msg("m2", "assistant")];
    const result = invokeBefore(makeEvent(entries, "__mm_compact__"));
    expect(result).toEqual({ cancel: true });
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]!.level).toBe("warning");
    expect(notifyCalls[0]!.msg).toContain("Too few messages");
  });

  it("/mm-compact with no user message compacts all instead of cancelling", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "assistant"),
      msg("m2", "assistant"),
      msg("m3", "assistant"),
    ];
    const result = invokeBefore(makeEvent(entries, "__mm_compact__"));
    expect(result.cancel).toBeUndefined();
    expect(result.compaction).toBeDefined();
    expect(result.compaction.firstKeptEntryId).toBe("");
  });

  it("/compact with override=true cancels and notifies", () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, invokeBefore, notifyCalls } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [msg("m1", "user"), msg("m2", "assistant")];
    const result = invokeBefore(makeEvent(entries, undefined));
    expect(result).toEqual({ cancel: true });
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]!.level).toBe("warning");
  });

  it("/compact with override=false short-circuits", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore, notifyCalls } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [msg("m1", "user"), msg("m2", "assistant")];
    const result = invokeBefore(makeEvent(entries, undefined));
    expect(result).toBeUndefined();
    expect(notifyCalls).toHaveLength(0);
  });

  it("overflow retry ownCut failure falls back to Pi core", () => {
    setConfig({ debug: true, overrideDefaultCompaction: true });
    const { pi, invokeBefore, notifyCalls } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [msg("m1", "user"), msg("m2", "assistant")];
    const result = invokeBefore(
      makeEvent(entries, undefined, {
        reason: "overflow",
        willRetry: true,
      }),
    );

    expect(result).toBeUndefined();
    expect(notifyCalls).toHaveLength(0);
    expect(existsSync(DEBUG_PATH)).toBe(true);
    const snapshot = JSON.parse(readFileSync(DEBUG_PATH, "utf-8"));
    expect(snapshot.cancelled).toBe(false);
    expect(snapshot.fallbackToCore).toBe(true);
    expect(snapshot.reason).toBe("too_few_live_messages");
    expect(snapshot.compaction).toEqual({
      reason: "overflow",
      willRetry: true,
    });
  });

  it("debug:true writes metrics-only snapshot on cancel with no content leakage", () => {
    setConfig({ debug: true, overrideDefaultCompaction: false });
    const { pi, invokeBefore } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user", "SECRET_TOKEN_abc123"),
      msg("m2", "assistant", "sensitive response"),
    ];
    const result = invokeBefore(makeEvent(entries, "__mm_compact__"));
    expect(result).toEqual({ cancel: true });

    expect(existsSync(DEBUG_PATH)).toBe(true);
    const snapshot = JSON.parse(readFileSync(DEBUG_PATH, "utf-8"));
    expect(snapshot.cancelled).toBe(true);
    expect(snapshot.reason).toBe("too_few_live_messages");

    // No content leakage
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("SECRET_TOKEN_abc123");
    expect(serialized).not.toContain("sensitive response");
  });

  it("debug:false does NOT write snapshot", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore } = createMockPi();
    registerBeforeCompactHook(pi);
    const entries = [msg("m1", "user"), msg("m2", "assistant")];
    const result = invokeBefore(makeEvent(entries, "__mm_compact__"));
    expect(result).toEqual({ cancel: true });
    expect(existsSync(DEBUG_PATH)).toBe(false);
  });
});

describe("registerBeforeCompactHook: compact-all path", () => {
  beforeEach(() => {
    if (existsSync(DEBUG_PATH)) {
      unlinkSync(DEBUG_PATH);
    }
  });
  afterEach(() => {
    if (existsSync(CONFIG_PATH)) {
      unlinkSync(CONFIG_PATH);
    }
    if (existsSync(DEBUG_PATH)) {
      unlinkSync(DEBUG_PATH);
    }
  });

  it("single-user + autonomous tail → returns compaction with empty firstKeptEntryId", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore, notifyCalls } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user", "go"),
      msg("m2", "assistant", "calling tool"),
      msg("m3", "toolResult", "result"),
      msg("m4", "assistant", "done"),
    ];
    const result = invokeBefore(makeEvent(entries, "__mm_compact__"));
    expect(result.compaction).toBeDefined();
    expect(result.compaction.firstKeptEntryId).toBe("");
    expect(notifyCalls).toHaveLength(0);
  });

  it("manual /mm-compact marker still compacts and records reason metadata", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user"),
      msg("m2", "assistant"),
      msg("m3", "user"),
      msg("m4", "assistant"),
    ];
    const result = invokeBefore(
      makeEvent(entries, "__mm_compact__", {
        reason: "manual",
        willRetry: false,
      }),
    );

    expect(result.compaction).toBeDefined();
    expect(result.compaction.firstKeptEntryId).toBe("m3");
    expect(result.compaction.details).toMatchObject({
      reason: "manual",
      willRetry: false,
    });
    expect(getLastCompactionStats()).toMatchObject({
      reason: "manual",
      willRetry: false,
    });
  });

  it("threshold override still compacts and records reason metadata", () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, invokeBefore } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user"),
      msg("m2", "assistant"),
      msg("m3", "user"),
      msg("m4", "assistant"),
    ];
    const result = invokeBefore(
      makeEvent(entries, undefined, {
        reason: "threshold",
        willRetry: false,
      }),
    );

    expect(result.compaction).toBeDefined();
    expect(result.compaction.firstKeptEntryId).toBe("m3");
    expect(result.compaction.details).toMatchObject({
      reason: "threshold",
      willRetry: false,
    });
    expect(getLastCompactionStats()).toMatchObject({
      reason: "threshold",
      willRetry: false,
    });
  });

  it("override=true + customInstructions sends follow-up user message after compact", async () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, invokeBefore, invokeCompact, userMessages, notifyCalls } =
      createMockPi();
    registerBeforeCompactHook(pi);
    const entries = [
      msg("m1", "user"),
      msg("m2", "assistant"),
      msg("m3", "user"),
      msg("m4", "assistant"),
    ];
    invokeBefore(makeEvent(entries, "continue"));
    await invokeCompact({
      type: "session_compact",
      fromExtension: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(userMessages).toEqual(["continue"]);
    expect(
      notifyCalls.some((call) =>
        call.msg.includes("tail kept 1/2 user turns (2 messages,"),
      ),
    ).toBe(true);
  });

  it("override=true + /compact keep prefix keeps requested turns and strips follow-up", async () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, invokeBefore, invokeCompact, userMessages } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user"),
      msg("m2", "assistant"),
      msg("m3", "user"),
      msg("m4", "assistant"),
      msg("m5", "user"),
      msg("m6", "assistant"),
      msg("m7", "user"),
      msg("m8", "assistant"),
    ];
    const result = invokeBefore(makeEvent(entries, "keep:3 continue"));
    await invokeCompact({
      type: "session_compact",
      fromExtension: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(result.compaction.firstKeptEntryId).toBe("m3");
    expect(getLastCompactionStats()).toMatchObject({
      keptUserTurns: 3,
      totalUserTurns: 4,
      requestedKeepUserTurns: 3,
      keepUserTurnsExplicit: true,
    });
    expect(userMessages).toEqual(["continue"]);
  });

  it("override=true + /compact keep suffix keeps requested turns and strips follow-up", async () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, invokeBefore, invokeCompact, userMessages } = createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user"),
      msg("m2", "assistant"),
      msg("m3", "user"),
      msg("m4", "assistant"),
      msg("m5", "user"),
      msg("m6", "assistant"),
    ];
    const result = invokeBefore(makeEvent(entries, "continue keep:2"));
    await invokeCompact({
      type: "session_compact",
      fromExtension: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(result.compaction.firstKeptEntryId).toBe("m3");
    expect(getLastCompactionStats()).toMatchObject({
      keptUserTurns: 2,
      totalUserTurns: 3,
      requestedKeepUserTurns: 2,
      keepUserTurnsExplicit: true,
    });
    expect(userMessages).toEqual(["continue"]);
  });

  it("session_compact overflow retry does not send follow-up prompt", async () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, invokeBefore, invokeCompact, userMessages, notifyCalls } =
      createMockPi();
    registerBeforeCompactHook(pi);

    const entries = [
      msg("m1", "user"),
      msg("m2", "assistant"),
      msg("m3", "user"),
      msg("m4", "assistant"),
    ];
    invokeBefore(
      makeEvent(entries, "continue", {
        reason: "overflow",
        willRetry: true,
      }),
    );
    await invokeCompact({
      type: "session_compact",
      fromExtension: true,
      reason: "overflow",
      willRetry: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(userMessages).toEqual([]);
    expect(notifyCalls).toEqual([]);
  });

  it("formatCompactionStats surfaces compact-all fallback when keep cannot be honored", () => {
    expect(
      formatCompactionStats({
        summarized: 2,
        kept: 4,
        keptUserTurns: 0,
        totalUserTurns: 2,
        requestedKeepUserTurns: 2,
        keepUserTurnsExplicit: true,
        keepFallbackToCompactAll: true,
        keptTokensEst: 10,
      }),
    ).toContain(
      "tail kept 0/2 user turns; requested keep:2, compact-all fallback",
    );
  });

  it("formatCompactionStats avoids requested keep wording for default compact-all fallback", () => {
    expect(
      formatCompactionStats({
        summarized: 2,
        kept: 4,
        keptUserTurns: 0,
        totalUserTurns: 1,
        requestedKeepUserTurns: 1,
        keepUserTurnsExplicit: false,
        keepFallbackToCompactAll: true,
        keptTokensEst: 10,
      }),
    ).toContain("tail kept 0/1 user turns; compact-all fallback");
  });

  it("/mm-compact keep instruction changes firstKeptEntryId and stats", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore } = createMockPi();
    registerBeforeCompactHook(pi);
    const entries = [
      msg("u1", "user", "one"),
      msg("a1", "assistant", "reply one"),
      msg("u2", "user", "two"),
      msg("a2", "assistant", "reply two"),
      msg("u3", "user", "three"),
      msg("a3", "assistant", "reply three"),
    ];

    const result = invokeBefore(makeEvent(entries, "__mm_compact__ keep:2"));

    expect(result.compaction.firstKeptEntryId).toBe("u2");
    expect(result.compaction.details.sourceMessageCount).toBe(2);
    expect(getLastCompactionStats()).toMatchObject({
      summarized: 2,
      kept: 4,
      keptUserTurns: 2,
      totalUserTurns: 3,
    });
  });

  it("/mm-compact marker with trailing prompt does not leak marker as follow-up", async () => {
    setConfig({ debug: false, overrideDefaultCompaction: true });
    const { pi, invokeBefore, invokeCompact, userMessages } = createMockPi();
    registerBeforeCompactHook(pi);
    const entries = [
      msg("u1", "user", "one"),
      msg("a1", "assistant", "reply one"),
      msg("u2", "user", "two"),
      msg("a2", "assistant", "reply two"),
      msg("u3", "user", "three"),
      msg("a3", "assistant", "reply three"),
    ];

    const result = invokeBefore(
      makeEvent(entries, "__mm_compact__ keep:2 continue"),
    );
    await invokeCompact({
      type: "session_compact",
      fromExtension: true,
      reason: "manual",
      willRetry: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(result.compaction.firstKeptEntryId).toBe("u2");
    expect(getLastCompactionStats()).toMatchObject({
      keptUserTurns: 2,
      keepUserTurnsExplicit: true,
    });
    expect(userMessages).toEqual([]);
  });

  it("huge keep instruction compacts all safely", () => {
    setConfig({ debug: false, overrideDefaultCompaction: false });
    const { pi, invokeBefore } = createMockPi();
    registerBeforeCompactHook(pi);
    const entries = [
      msg("u1", "user", "one"),
      msg("a1", "assistant", "reply one"),
      msg("u2", "user", "two"),
      msg("a2", "assistant", "reply two"),
    ];

    const result = invokeBefore(
      makeEvent(entries, "__mm_compact__ keep:999999999999999999999"),
    );

    expect(result.compaction.firstKeptEntryId).toBe("");
    expect(getLastCompactionStats()).toMatchObject({
      keptUserTurns: 0,
      totalUserTurns: 2,
    });
  });
});
