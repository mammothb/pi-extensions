import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * Create a mock Theme that wraps styled text in tags so rendering
 * output is predictable and testable without real ANSI escapes.
 */
export function createMockTheme(): Theme {
  const mk = {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
    bg: (color: string, text: string) => `[bg:${color}]${text}[/bg:${color}]`,
    bold: (text: string) => `[bold]${text}[/bold]`,
    italic: (text: string) => `[italic]${text}[/italic]`,
    underline: (text: string) => `[underline]${text}[/underline]`,
    inverse: (text: string) => `[inverse]${text}[/inverse]`,
    strikethrough: (text: string) => `[strikethrough]${text}[/strikethrough]`,
  };
  return mk as unknown as Theme;
}
