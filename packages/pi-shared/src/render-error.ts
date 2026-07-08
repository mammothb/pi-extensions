import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getExpandKey } from "./get-expand-key.js";

interface RenderErrorOpts {
  /** Prefix displayed before the error message (e.g. tool name). */
  toolLabel?: string;
  /** Show Ctrl+O expand hint after the error text. */
  expandable?: boolean;
}

/** Render a tool error — used as an early return in renderResult. */
export function renderError(
  rawText: string,
  theme: Theme,
  opts?: RenderErrorOpts,
): Text {
  let text = opts?.toolLabel
    ? theme.fg("error", `${opts.toolLabel}: ${rawText}`)
    : theme.fg("error", rawText);

  if (opts?.expandable) {
    text += `  ${theme.fg("muted", getExpandKey())}`;
  }

  return new Text(text, 0, 0);
}
