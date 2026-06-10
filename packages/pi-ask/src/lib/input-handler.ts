import {
  Key,
  type KeybindingsManager,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { Question } from "../schema.js";
import type { EditorAdapter } from "./editor-adapter.js";
import { getOptions, type QuestionState } from "./state.js";

/**
 * Callbacks that the input handler uses to signal state changes.
 * The component wires these to state mutations + render invalidation.
 */
export interface InputDeps {
  questions: Question[];
  states: QuestionState[];
  activeTab: number;
  isSingle: boolean;
  totalTabs: number;
  editor: EditorAdapter | null;
  kb: KeybindingsManager;

  // State mutation callbacks
  onMoveCursor(delta: -1 | 1): void;
  onToggleSelected(index: number): void;
  onSelectOption(index: number): void;
  onEnterEditMode(): void;
  onExitEditMode(save: boolean): void;
  onClearFreeTextAndUnconfirmIfNeeded(): void;
  onAutoConfirmIfAnswered(): void;
  onConfirmAndAdvance(): void;
  onChangeTab(newTab: number): void;
  onSubmit(): void;
  onCancel(): void;
  onRequestRender(): void;
}

/**
 * Dispatch a key event against the current UI state.
 * Returns true if the key was consumed.
 */
export function handleInput(data: string, ctx: InputDeps): boolean {
  // Submit tab (only for multi-question; activeTab === questions.length)
  if (!ctx.isSingle && ctx.activeTab === ctx.questions.length) {
    return handleSubmitTabInput(data, ctx);
  }

  const state = ctx.states[ctx.activeTab];
  const q = ctx.questions[ctx.activeTab];
  if (!state || !q) return false;

  // Edit mode: route to inline editor
  if (state.inEditMode) {
    return handleEditModeInput(data, ctx, q);
  }

  // Normal question tab
  return handleQuestionTabInput(data, ctx, state, q);
}

// ── Submit tab ───────────────────────────────────────────────────────────────

function handleSubmitTabInput(data: string, ctx: InputDeps): boolean {
  if (matchesKey(data, Key.enter)) {
    // allConfirmed check is done by the caller; the Submit tab's Enter
    // callback is wired so the component only calls onSubmit when allConfirmed.
    ctx.onSubmit();
    return true;
  }
  if (matchesKey(data, Key.escape)) {
    ctx.onCancel();
    return true;
  }
  if (ctx.kb.matches(data, "pi-ask.nextTab")) {
    ctx.onChangeTab(0);
    return true;
  }
  if (ctx.kb.matches(data, "pi-ask.prevTab")) {
    ctx.onChangeTab(ctx.questions.length - 1);
    return true;
  }
  return false;
}

// ── Edit mode ────────────────────────────────────────────────────────────────

function handleEditModeInput(
  data: string,
  ctx: InputDeps,
  q: Question,
): boolean {
  if (matchesKey(data, Key.escape)) {
    ctx.onExitEditMode(false);
    ctx.onRequestRender();
    return true;
  }

  if (matchesKey(data, Key.enter)) {
    const editor = ctx.editor;
    if (!editor) return false;

    const text = editor.getText().trim();
    if (text) {
      ctx.onExitEditMode(true);
      // Single-select: auto-confirm since free-text is the only answer.
      // Multi-select: just return to options so user can still toggle checkboxes.
      if (!q.multi) {
        ctx.onConfirmAndAdvance();
      } else {
        ctx.onRequestRender();
      }
    } else {
      // Empty text — clear any previously saved free-text answer
      ctx.onClearFreeTextAndUnconfirmIfNeeded();
      ctx.onExitEditMode(false);
      ctx.onRequestRender();
    }
    return true;
  }

  // Delegate other keys to the inline editor
  ctx.editor?.handleInput(data);
  ctx.onRequestRender();
  return true;
}

// ── Question tab ─────────────────────────────────────────────────────────────

function handleQuestionTabInput(
  data: string,
  ctx: InputDeps,
  state: QuestionState,
  q: Question,
): boolean {
  // Global keys
  if (matchesKey(data, Key.escape)) {
    ctx.onCancel();
    return true;
  }

  // Tab navigation (multi-question only)
  if (!ctx.isSingle && ctx.kb.matches(data, "pi-ask.nextTab")) {
    ctx.onAutoConfirmIfAnswered();
    ctx.onChangeTab((ctx.activeTab + 1) % ctx.totalTabs);
    return true;
  }

  if (!ctx.isSingle && ctx.kb.matches(data, "pi-ask.prevTab")) {
    ctx.onAutoConfirmIfAnswered();
    ctx.onChangeTab((ctx.activeTab - 1 + ctx.totalTabs) % ctx.totalTabs);
    return true;
  }

  // Cursor navigation
  if (ctx.kb.matches(data, "pi-ask.cursorUp")) {
    ctx.onMoveCursor(-1);
    return true;
  }

  if (ctx.kb.matches(data, "pi-ask.cursorDown")) {
    ctx.onMoveCursor(1);
    return true;
  }

  const opts = getOptions(q);
  const isOnOther = state.cursorIndex === opts.length - 1;

  // "Type your own answer..." actions
  if (isOnOther) {
    if (matchesKey(data, Key.space) || matchesKey(data, Key.tab)) {
      ctx.onEnterEditMode();
      return true;
    }
    // Enter confirms if there's already a saved free-text answer
    if (matchesKey(data, Key.enter) && state.freeTextValue !== null) {
      ctx.onConfirmAndAdvance();
      return true;
    }
  }

  // Multi-select actions
  if (q.multi && !isOnOther) {
    if (matchesKey(data, Key.space)) {
      ctx.onToggleSelected(state.cursorIndex);
      return true;
    }
    if (matchesKey(data, Key.enter)) {
      if (state.selectedIndices.size > 0 || state.freeTextValue !== null) {
        ctx.onConfirmAndAdvance();
        return true;
      }
    }
  }

  // Single-select action
  if (!q.multi && !isOnOther) {
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      ctx.onSelectOption(state.cursorIndex);
      ctx.onConfirmAndAdvance();
      return true;
    }
  }

  return false;
}
