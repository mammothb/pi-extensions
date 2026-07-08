import { keyText, type Theme } from "@earendil-works/pi-coding-agent";

/** Get the display string for the expand keybinding (e.g. "Ctrl+O"). */
export function getExpandKey(): string {
  return keyText("app.tools.expand") || "Ctrl+O";
}

/** Muted "Ctrl+O to collapse" hint for expanded views. */
export function getCollapseHint(theme: Theme): string {
  return theme.fg("muted", `${getExpandKey()} to collapse`);
}

/** Muted expand hint for collapsed views. Pass `remaining` for "... (N more lines, Ctrl+O to expand)" format. */
export function getExpandHint(theme: Theme, remaining?: number): string {
  const key = getExpandKey();
  if (remaining !== undefined && remaining > 0) {
    return (
      theme.fg("muted", `... (${remaining} more lines, `) +
      theme.fg("muted", key) +
      theme.fg("muted", " to expand)")
    );
  }
  return theme.fg("muted", `${getExpandKey()} to expand`);
}
