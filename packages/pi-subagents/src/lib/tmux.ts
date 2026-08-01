import { execFileSync, execSync } from "node:child_process";

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
    const name = execSync("tmux display-message -p '#S'", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: TMUX_STDIO,
    }).trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Split the current tmux window and run a command in the new pane.
 * Returns the pane ID (e.g. "%3").
 *
 * @param command  Shell command to run in the new pane.
 * @param direction  Split direction — "h" (horizontal, default) or "v".
 */
export function tmuxSplitWindow(
  command: string,
  direction: "h" | "v" = "h",
): string {
  const args = [
    "split-window",
    `-${direction}`,
    "-d",
    "-P",
    "-F",
    "#{pane_id}",
  ];

  args.push("--", command);

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
