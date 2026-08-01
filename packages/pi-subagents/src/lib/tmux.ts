import { execFileSync } from "node:child_process";

/**
 * tmux errors (e.g. "can't find pane") must not leak to the terminal —
 * all calls here treat failure via exit code / exceptions. execFileSync
 * and execSync print the child's stderr on failure, so discard it.
 */
const TMUX_STDIO: ["ignore", "pipe", "ignore"] = ["ignore", "pipe", "ignore"];

/**
 * Check if we're inside a tmux session.
 */
export function tmuxActive(): boolean {
  return !!process.env.TMUX;
}

/**
 * Get the active tmux session name.
 */
export function tmuxGetSessionName(): string | null {
  try {
    const name = execFileSync("tmux", ["display-message", "-p", "#S"], {
      encoding: "utf-8",
      stdio: TMUX_STDIO,
    }).trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Split the current tmux window, creating an empty pane (the default shell
 * starts in it). The child command is sent later via tmuxSendKeys, so the
 * parent can finish bookkeeping before the child boots. Returns the pane
 * ID (e.g. "%3").
 *
 * @param direction  Split direction — "h" (horizontal, default) or "v".
 */
export function tmuxSplitWindow(direction: "h" | "v" = "h"): string {
  const args = [
    "split-window",
    `-${direction}`,
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
  ];

  const pane = execFileSync("tmux", args, {
    encoding: "utf-8",
    stdio: TMUX_STDIO,
  }).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Unexpected tmux split-window output: ${pane}`);
  }
  return pane;
}

/**
 * Focus a pane (make it the active pane). Used to jump the user straight
 * into a newly spawned research pane after /rsh.
 */
export function tmuxSelectPane(paneId: string): void {
  execFileSync("tmux", ["select-pane", "-t", paneId], {
    encoding: "utf-8",
    stdio: TMUX_STDIO,
  });
}

/**
 * Type a command into a pane as literal text, then press Enter.
 * Used to start a research child after the parent's bookkeeping is done.
 */
export function tmuxSendKeys(paneId: string, command: string): void {
  execFileSync("tmux", ["send-keys", "-t", paneId, "-l", command], {
    encoding: "utf-8",
    stdio: TMUX_STDIO,
  });
  execFileSync("tmux", ["send-keys", "-t", paneId, "Enter"], {
    encoding: "utf-8",
    stdio: TMUX_STDIO,
  });
}

/**
 * Kill a tmux pane by its pane ID.
 */
export function tmuxKillPane(paneId: string): void {
  execFileSync("tmux", ["kill-pane", "-t", paneId], {
    encoding: "utf-8",
    stdio: TMUX_STDIO,
  });
}

/**
 * Check if a tmux pane is still alive.
 */
export function tmuxPaneAlive(paneId: string): boolean {
  try {
    execFileSync("tmux", ["list-panes", "-t", paneId], {
      encoding: "utf-8",
      stdio: TMUX_STDIO,
    });
    return true;
  } catch {
    return false;
  }
}
