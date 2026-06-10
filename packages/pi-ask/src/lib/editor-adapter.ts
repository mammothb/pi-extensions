import type { Theme } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";

/**
 * Minimal interface for the inline text editor, so the component can be
 * tested with a stub instead of a real pi TUI Editor.
 */
export interface EditorAdapter {
  getText(): string;
  setText(text: string): void;
  handleInput(data: string): void;
  render(width: number): string[];
}

/**
 * Create the real EditorAdapter backed by a pi TUI Editor.
 * The `onChange` callback fires on every keystroke so the parent can
 * invalidate its render cache and request a repaint.
 */
export function createEditorAdapter(
  tui: TUI,
  theme: Theme,
  onChange: () => void,
): EditorAdapter {
  const editorTheme: EditorTheme = {
    borderColor: (s) => theme.fg("muted", s),
    selectList: {
      selectedPrefix: (s) => theme.fg("accent", s),
      selectedText: (s) => theme.fg("accent", s),
      description: (s) => theme.fg("muted", s),
      scrollInfo: (s) => theme.fg("dim", s),
      noMatch: (s) => theme.fg("warning", s),
    },
  };

  const editor = new Editor(tui, editorTheme);
  editor.disableSubmit = true;
  editor.onChange = onChange;

  return {
    getText: () => editor.getText(),
    setText: (text) => editor.setText(text),
    handleInput: (data) => editor.handleInput(data),
    render: (width) => editor.render(width),
  };
}
