import type { Theme } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  KeybindingsManager,
  TUI,
} from "@earendil-works/pi-tui";
import type { QuestionT, ResultT } from "../schema.js";
import { createEditorAdapter, type IEditorAdapter } from "./editor-adapter.js";
import { handleInput, type InputContext } from "./input-handler.js";
import { renderAskComponent } from "./renderer.js";
import {
  allOptions,
  allConfirmed as allQuestionsConfirmed,
  autoConfirmIfAnswered,
  buildResult,
  clearFreeTextAndUnconfirmIfNeeded,
  confirm,
  createInitialStates,
  enterEditMode,
  exitEditMode,
  moveCursor,
  type QuestionState,
  selectOption,
  toggleSelected,
} from "./state.js";

/** Narrow the active tab's state+question pair, handling the Submit-tab case. */
function activePair(
  states: QuestionState[],
  questions: QuestionT[],
  activeTab: number,
): { state: QuestionState; q: QuestionT } | null {
  const state = states[activeTab];
  const q = questions[activeTab];
  if (!state || !q) {
    return null;
  }
  return { state, q };
}

export class AskComponent implements Component {
  private questions: QuestionT[];
  private theme: Theme;
  private tui: TUI;
  private kb: KeybindingsManager;
  private editor: IEditorAdapter;
  private done: (result: ResultT | null) => void;

  private states: QuestionState[];
  private activeTab = 0;
  private resolved = false;

  // Render cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    questions: QuestionT[],
    tui: TUI,
    theme: Theme,
    done: (result: ResultT | null) => void,
    kb: KeybindingsManager,
  ) {
    this.questions = questions;
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.kb = kb;
    this.states = createInitialStates(questions);
    this.editor = createEditorAdapter(tui, theme, () => {
      this.invalidate();
      this.tui.requestRender();
    });

    this.invalidate();
  }

  // ── Public Component interface ──────────────────────────────────────────

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) {
      return this.cachedLines;
    }

    if (this.questions.length === 0) {
      return [];
    }

    const lines = renderAskComponent(
      this.questions,
      this.states,
      this.activeTab,
      this.questions.length === 1,
      this.theme,
      width,
      this.editor,
    );

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  handleInput(data: string): void {
    if (this.resolved) {
      return;
    }

    // Submit-tab Enter must only submit when all questions are confirmed.
    // The input handler fires onSubmit for any Enter on the Submit tab,
    // so wrap it with a guard.
    const ctx: InputContext = {
      questions: this.questions,
      states: this.states,
      activeTab: this.activeTab,
      isSingle: this.questions.length === 1,
      totalTabs: this.questions.length + 1,
      editor: this.editor,
      kb: this.kb,

      onMoveCursor: (delta) => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        moveCursor(pair.state, delta, allOptions(pair.q).length);
        this.invalidate();
        this.tui.requestRender();
      },

      onToggleSelected: (index) => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        toggleSelected(pair.state, index);
        this.invalidate();
        this.tui.requestRender();
      },

      onSelectOption: (index) => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        selectOption(pair.state, index);
      },

      onEnterEditMode: () => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        enterEditMode(pair.state, this.editor);
        this.invalidate();
        this.tui.requestRender();
      },

      onExitEditMode: (save) => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        exitEditMode(pair.state, this.editor, save);
        this.invalidate();
      },

      onClearFreeTextAndUnconfirmIfNeeded: () => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        clearFreeTextAndUnconfirmIfNeeded(pair.state, pair.q);
      },

      onAutoConfirmIfAnswered: () => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        autoConfirmIfAnswered(pair.state, pair.q);
      },

      onConfirmAndAdvance: () => {
        const pair = activePair(this.states, this.questions, this.activeTab);
        if (!pair) return;
        confirm(pair.state);
        this.advance();
      },

      onChangeTab: (newTab) => {
        this.activeTab = newTab;
        this.invalidate();
        this.tui.requestRender();
      },

      onSubmit: () => {
        if (allQuestionsConfirmed(this.states)) {
          this.submit();
        }
      },

      onCancel: () => {
        this.cancel();
      },

      onRequestRender: () => {
        this.tui.requestRender();
      },
    };

    handleInput(data, ctx);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private advance(): void {
    if (this.questions.length === 1) {
      this.submit();
      return;
    }
    if (this.activeTab < this.questions.length - 1) {
      this.activeTab++;
    } else {
      this.activeTab = this.questions.length; // Submit tab
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private submit(): void {
    this.resolved = true;
    this.done(buildResult(this.questions, this.states));
  }

  private cancel(): void {
    this.resolved = true;
    this.done(null);
  }
}
