import { execFileSync } from "node:child_process";

/**
 * tmux errors (e.g. "can't find pane") must not leak to the terminal —
 * all calls here treat failure via exit code / exceptions. execFileSync
 * and execSync print the child's stderr on failure, so discard it.
 */
const TMUX_STDIO: ["ignore", "pipe", "ignore"] = ["ignore", "pipe", "ignore"];

/**
 * Shared execFileSync options for all tmux calls: keep the stdio discard
 * behavior above, capture stdout as text, and bound the wait — a tmux
 * server that stops responding must not block pi indefinitely.
 */
const TMUX_EXEC_OPTS: {
  encoding: "utf-8";
  stdio: ["ignore", "pipe", "ignore"];
  timeout: number;
} = {
  encoding: "utf-8",
  stdio: TMUX_STDIO,
  timeout: 5_000,
};

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
    const name = execFileSync(
      "tmux",
      ["display-message", "-p", "#S"],
      TMUX_EXEC_OPTS,
    ).trim();
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

  const pane = execFileSync("tmux", args, TMUX_EXEC_OPTS).trim();
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
  execFileSync("tmux", ["select-pane", "-t", paneId], TMUX_EXEC_OPTS);
}

/**
 * Type a command into a pane as literal text, then press Enter.
 * Used to start a research child after the parent's bookkeeping is done.
 */
export function tmuxSendKeys(paneId: string, command: string): void {
  execFileSync(
    "tmux",
    ["send-keys", "-t", paneId, "-l", command],
    TMUX_EXEC_OPTS,
  );
  execFileSync("tmux", ["send-keys", "-t", paneId, "Enter"], TMUX_EXEC_OPTS);
}

/**
 * Kill a tmux pane by its pane ID.
 */
export function tmuxKillPane(paneId: string): void {
  execFileSync("tmux", ["kill-pane", "-t", paneId], TMUX_EXEC_OPTS);
}

/**
 * Check if a tmux pane is still alive.
 */
export function tmuxPaneAlive(paneId: string): boolean {
  try {
    execFileSync("tmux", ["list-panes", "-t", paneId], TMUX_EXEC_OPTS);
    return true;
  } catch {
    return false;
  }
}
