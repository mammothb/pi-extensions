import { TruncatedText } from "@earendil-works/pi-tui";

/**
 * A TruncatedText variant that preserves background colors.
 *
 * Standard TruncatedText uses \x1b[0m (full SGR reset) before the ellipsis,
 * which kills any background color applied by a parent Box. This subclass
 * replaces the full reset with \x1b[39m (reset foreground only), so the
 * ellipsis still appears unstyled while background colors survive intact.
 */
export class BgSafeTruncatedText extends TruncatedText {
  render(width: number): string[] {
    return super.render(width).map((line) =>
      line.replace(/\x1b\[0m/g, "\x1b[39m"),
    );
  }
}
