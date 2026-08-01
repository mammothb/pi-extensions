import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

import {
  tmuxActive,
  tmuxGetSessionName,
  tmuxKillPane,
  tmuxPaneAlive,
  tmuxSelectPane,
  tmuxSendKeys,
  tmuxSplitWindow,
} from "../src/lib/tmux.js";

const execMock = execFileSync as unknown as ReturnType<typeof vi.fn>;

describe("tmux helpers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("tmuxActive reflects the TMUX env var", () => {
    const prev = process.env.TMUX;
    try {
      delete process.env.TMUX;
      expect(tmuxActive()).toBe(false);
      process.env.TMUX = "1";
      expect(tmuxActive()).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.TMUX;
      } else {
        process.env.TMUX = prev;
      }
    }
  });

  it("uses the shared exec options with a bounded timeout", () => {
    execMock.mockReturnValue("x");
    tmuxGetSessionName();
    const opts = execMock.mock.calls[0]![2] as {
      timeout?: number;
      stdio?: unknown;
    };
    expect(opts.timeout).toBe(5_000);
    expect(opts.stdio).toEqual(["ignore", "pipe", "ignore"]);
  });

  it("tmuxGetSessionName returns the trimmed session name", () => {
    execMock.mockReturnValue("  mysession  \n");
    expect(tmuxGetSessionName()).toBe("mysession");
  });

  it("tmuxGetSessionName returns null for empty output or errors", () => {
    execMock.mockReturnValue("\n");
    expect(tmuxGetSessionName()).toBeNull();

    execMock.mockImplementation(() => {
      throw new Error("no server");
    });
    expect(tmuxGetSessionName()).toBeNull();
  });

  it("tmuxSplitWindow returns the pane id and builds split args", () => {
    execMock.mockReturnValue("%3");
    expect(tmuxSplitWindow("h")).toBe("%3");
    expect(execMock).toHaveBeenCalledWith(
      "tmux",
      ["split-window", "-h", "-d", "-P", "-F", "#{pane_id}"],
      expect.objectContaining({ timeout: 5_000 }),
    );

    execMock.mockReturnValue("%4");
    expect(tmuxSplitWindow("v")).toBe("%4");
    expect(execMock).toHaveBeenCalledWith(
      "tmux",
      ["split-window", "-v", "-d", "-P", "-F", "#{pane_id}"],
      expect.anything(),
    );
  });

  it("tmuxSplitWindow throws on unexpected output", () => {
    execMock.mockReturnValue("unexpected");
    expect(() => tmuxSplitWindow("h")).toThrow(/Unexpected tmux/);
  });

  it("tmuxSelectPane focuses the pane", () => {
    execMock.mockReturnValue("");
    tmuxSelectPane("%3");
    expect(execMock).toHaveBeenCalledWith(
      "tmux",
      ["select-pane", "-t", "%3"],
      expect.anything(),
    );
  });

  it("tmuxSendKeys types the command and presses Enter", () => {
    execMock.mockReturnValue("");
    tmuxSendKeys("%3", "pi --help");
    expect(execMock).toHaveBeenNthCalledWith(
      1,
      "tmux",
      ["send-keys", "-t", "%3", "-l", "pi --help"],
      expect.anything(),
    );
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      "tmux",
      ["send-keys", "-t", "%3", "Enter"],
      expect.anything(),
    );
  });

  it("tmuxKillPane kills the pane", () => {
    execMock.mockReturnValue("");
    tmuxKillPane("%3");
    expect(execMock).toHaveBeenCalledWith(
      "tmux",
      ["kill-pane", "-t", "%3"],
      expect.anything(),
    );
  });

  it("tmuxPaneAlive reports success and failures", () => {
    execMock.mockReturnValue("");
    expect(tmuxPaneAlive("%3")).toBe(true);

    execMock.mockImplementation(() => {
      throw new Error("can't find pane");
    });
    expect(tmuxPaneAlive("%3")).toBe(false);
  });
});
