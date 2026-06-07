import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

/** Render a tool error — used as an early return in renderResult. */
export function renderError(rawText: string, theme: Theme): Text {
  return new Text(theme.fg("error", rawText), 0, 0);
}
