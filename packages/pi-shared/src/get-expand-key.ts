import { keyText } from "@earendil-works/pi-coding-agent";

/** Get the display string for the expand keybinding (e.g. "Ctrl+O"). */
export function getExpandKey(): string {
  return keyText("app.tools.expand") || "Ctrl+O";
}
