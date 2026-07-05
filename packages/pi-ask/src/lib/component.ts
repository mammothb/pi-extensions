import type { Theme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import type { AskResult, Question } from "../schema.js";
import { createEditorAdapter, type EditorAdapter } from "./editor-adapter.js";
import { handleInput, type InputDeps } from "./input-handler.js";
import { renderAskComponent } from "./renderer.js";
import {
  allConfirmed as allQuestionsConfirmed,
  autoConfirmIfAnswered,
  buildResult,
  clearFreeTextAndUnconfirmIfNeeded,
  confirm,
  createInitialStates,
  enterEditMode,
  exitEditMode,
  getOptions,
  moveCursor,
  type QuestionState,
  selectOption,
  toggleSelected,
} from "./state.js";

/** Narrow the active tab's state+question pair, handling the Submit-tab case. */
function activePair(
  states: QuestionState[],
  questions: Question[],
  activeTab: number,
): { state: QuestionState; q: Question } | null {
  const state = states[activeTab];
  const q = questions[activeTab];
  if (!state || !q) {
    return null;
  }
  return { state, q };
}

export class AskComponent implements Component {
  #questions: Question[];
  #theme: Theme;
  #tui: TUI;
  #kb: KeybindingsManager;
  #editor: EditorAdapter;
  #done: (result: AskResult | null) => void;

  #states: QuestionState[];
  #activeTab = 0;
  #resolved = false;

  // Render cache
  #cachedWidth?: number;
  #cachedLines?: string[];

  constructor(
    questions: Question[],
    tui: TUI,
    theme: Theme,
    done: (result: AskResult | null) => void,
    kb: KeybindingsManager,
  ) {
    this.#questions = questions;
    this.#tui = tui;
    this.#theme = theme;
    this.#done = done;
    this.#kb = kb;
    this.#states = createInitialStates(questions);
    this.#editor = createEditorAdapter(tui, theme, () => {
      this.invalidate();
      this.#tui.requestRender();
    });

    this.invalidate();
  }

  // ── Public Component interface ──────────────────────────────────────────

  invalidate(): void {
    this.#cachedWidth = undefined;
    this.#cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.#cachedWidth === width && this.#cachedLines) {
      return this.#cachedLines;
    }

    if (this.#questions.length === 0) {
      return [];
    }

    const lines = renderAskComponent(
      this.#questions,
      this.#states,
      this.#activeTab,
      this.#questions.length === 1,
      this.#theme,
      width,
      this.#editor,
    );

    this.#cachedWidth = width;
    this.#cachedLines = lines;
    return lines;
  }

  handleInput(data: string): void {
    if (this.#resolved) {
      return;
    }

    // Submit-tab Enter must only submit when all questions are confirmed.
    // The input handler fires onSubmit for any Enter on the Submit tab,
    // so wrap it with a guard.
    const ctx: InputDeps = {
      questions: this.#questions,
      states: this.#states,
      activeTab: this.#activeTab,
      isSingle: this.#questions.length === 1,
      totalTabs: this.#questions.length + 1,
      editor: this.#editor,
      kb: this.#kb,

      onMoveCursor: (delta) => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        moveCursor(pair.state, delta, getOptions(pair.q).length);
        this.invalidate();
        this.#tui.requestRender();
      },

      onToggleSelected: (index) => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        toggleSelected(pair.state, index);
        this.invalidate();
        this.#tui.requestRender();
      },

      onSelectOption: (index) => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        selectOption(pair.state, index);
      },

      onEnterEditMode: () => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        enterEditMode(pair.state, this.#editor);
        this.invalidate();
        this.#tui.requestRender();
      },

      onExitEditMode: (save) => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        exitEditMode(pair.state, this.#editor, save);
        this.invalidate();
      },

      onClearFreeTextAndUnconfirmIfNeeded: () => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        clearFreeTextAndUnconfirmIfNeeded(pair.state, pair.q);
      },

      onAutoConfirmIfAnswered: () => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        autoConfirmIfAnswered(pair.state, pair.q);
      },

      onConfirmAndAdvance: () => {
        const pair = activePair(this.#states, this.#questions, this.#activeTab);
        if (!pair) {
          return;
        }
        confirm(pair.state);
        this.#advance();
      },

      onChangeTab: (newTab) => {
        this.#activeTab = newTab;
        this.invalidate();
        this.#tui.requestRender();
      },

      onSubmit: () => {
        if (allQuestionsConfirmed(this.#states)) {
          this.#submit();
        }
      },

      onCancel: () => {
        this.#cancel();
      },

      onRequestRender: () => {
        this.invalidate();
        this.#tui.requestRender();
      },
    };

    handleInput(data, ctx);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  #advance(): void {
    if (this.#questions.length === 1) {
      this.#submit();
      return;
    }
    if (this.#activeTab < this.#questions.length - 1) {
      this.#activeTab++;
    } else {
      this.#activeTab = this.#questions.length; // Submit tab
    }
    this.invalidate();
    this.#tui.requestRender();
  }

  #submit(): void {
    this.#resolved = true;
    this.#done(buildResult(this.#questions, this.#states));
  }

  #cancel(): void {
    this.#resolved = true;
    this.#done(null);
  }
}
