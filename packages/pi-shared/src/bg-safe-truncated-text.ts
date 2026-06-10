import { TruncatedText } from "@earendil-works/pi-tui";

/**
 * A TruncatedText variant that preserves background colors.
 *
 * Standard TruncatedText uses \x1b[0m (full SGR reset) before the ellipsis,
 * which kills any background color applied by a parent Box. This subclass
 * replaces the full reset with \x1b[39m (reset foreground only), so the
 * ellipsis still appears unstyled while background colors survive intact.
 */
const ESC = "\x1b";
const RESET_ALL = new RegExp(`${ESC}\\[0m`, "g");
const RESET_FG = `${ESC}[39m`;

export class BgSafeTruncatedText extends TruncatedText {
  render(width: number): string[] {
    return super.render(width).map((line) => line.replace(RESET_ALL, RESET_FG));
  }
}
