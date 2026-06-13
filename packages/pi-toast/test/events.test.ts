import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  AskPromptPayload,
  PermissionPromptPayload,
} from "@mammothb/pi-shared";
import { describe, expect, it, vi } from "vitest";

// ── mocks ──────────────────────────────────────────────────────────────────

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// execFile is called via promisify(execFile) — promisify adds the callback as
// the last argument. Original signature: execFile(file, args[, options], callback).
// Our calls use 2 args (file, args) so promisify passes callback as 3rd arg.
type ExecFileCallback = (
  err: NodeJS.ErrnoException | null,
  result: { stdout: string; stderr: string },
) => void;

mockExecFile.mockImplementation(
  (_cmd: string, _args: string[], cb: ExecFileCallback) => {
    cb(null, { stdout: "", stderr: "" });
  },
);

// ── helpers ────────────────────────────────────────────────────────────────

interface MockEvents {
  listeners: Map<string, Array<(data: unknown) => void>>;
  on(event: string, handler: (data: unknown) => void): void;
  off(): void;
  emit(event: string, data: unknown): void;
}

function createMockEvents(): MockEvents {
  const listeners = new Map<string, Array<(data: unknown) => void>>();

  return {
    listeners,
    on(event: string, handler: (data: unknown) => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
    },
    off() {},
    emit(event: string, data: unknown) {
      const handlers = listeners.get(event);
      if (handlers) {
        for (const handler of handlers) {
          handler(data);
        }
      }
    },
  };
}

function createMockPi(): {
  pi: ExtensionAPI;
  events: MockEvents;
} {
  const events = createMockEvents();

  const pi = {
    events: events as unknown as ExtensionAPI["events"],
    on() {},
  } as unknown as ExtensionAPI;

  return { pi, events };
}

// ── config setup ───────────────────────────────────────────────────────────

vi.mock("../src/config.js", () => ({
  loadConfig: () => ({ path: "/usr/bin/notify-send" }),
}));

// ── tests ──────────────────────────────────────────────────────────────────

describe("pi-toast events", () => {
  it("sends toast on AskUserQuestion:prompt (single question)", async () => {
    const { pi, events } = createMockPi();

    // Load extension — subscribes event listeners
    const { default: toastExtension } = await import("../index.js");
    await toastExtension(pi);

    // Clear the getSessionLabel() call (may call execFile for tmux)
    mockExecFile.mockClear();

    const payload: AskPromptPayload = {
      questions: [
        {
          header: "Style",
          question: "Which style?",
          options: [{ label: "A" }, { label: "B" }],
          multi: false,
        },
      ],
    };
    events.emit("AskUserQuestion:prompt", payload);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [cmd, args] = mockExecFile.mock.calls[0] as [
      string,
      string[],
      ExecFileCallback,
    ];
    expect(cmd).toBe("/usr/bin/notify-send");
    expect(args[0]).toContain("pi-ask: Question");
    // Title contains session label (TMUX check runs, likely "(shell)")
    expect(args[1]).toBe("Style");
  });

  it("sends toast on AskUserQuestion:prompt (multiple questions)", async () => {
    const { pi, events } = createMockPi();

    const { default: toastExtension } = await import("../index.js");
    await toastExtension(pi);
    mockExecFile.mockClear();

    const payload: AskPromptPayload = {
      questions: [
        {
          header: "A",
          question: "First?",
          options: [{ label: "X" }],
          multi: false,
        },
        {
          header: "B",
          question: "Second?",
          options: [{ label: "Y" }],
          multi: false,
        },
      ],
    };
    events.emit("AskUserQuestion:prompt", payload);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [, args] = mockExecFile.mock.calls[0] as [
      string,
      string[],
      ExecFileCallback,
    ];
    expect(args[1]).toBe("A, B (2 questions)");
  });

  it("sends toast on bash_permission:prompt", async () => {
    const { pi, events } = createMockPi();

    const { default: toastExtension } = await import("../index.js");
    await toastExtension(pi);
    mockExecFile.mockClear();

    const payload: PermissionPromptPayload = {
      toolName: "bash",
      category: "bash",
      summary: "rm -rf /",
      reason: "matched rule",
    };
    events.emit("bash_permission:prompt", payload);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [, args] = mockExecFile.mock.calls[0] as [
      string,
      string[],
      ExecFileCallback,
    ];
    expect(args[0]).toContain("pi-perms: Permission Required");
    expect(args[1]).toBe("[bash] rm -rf / — matched rule");
  });

  it("omits reason suffix when reason is undefined", async () => {
    const { pi, events } = createMockPi();

    const { default: toastExtension } = await import("../index.js");
    await toastExtension(pi);
    mockExecFile.mockClear();

    const payload: PermissionPromptPayload = {
      toolName: "write",
      category: "path",
      summary: "src/index.ts",
    };
    events.emit("write_permission:prompt", payload);

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const [, args] = mockExecFile.mock.calls[0] as [
      string,
      string[],
      ExecFileCallback,
    ];
    expect(args[1]).toBe("[write] src/index.ts");
  });

  it("subscribes to all known permission tool events", async () => {
    const { pi, events } = createMockPi();
    mockExecFile.mockClear();

    const { default: toastExtension } = await import("../index.js");
    await toastExtension(pi);

    const knownTools = ["bash", "read", "write", "edit", "grep", "find", "ls"];

    for (const tool of knownTools) {
      mockExecFile.mockClear();
      const payload: PermissionPromptPayload = {
        toolName: tool,
        category: "tool",
        summary: "test",
      };
      events.emit(`${tool}_permission:prompt`, payload);
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    }
  });
});
