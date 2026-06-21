import type { AskResult, Option, Question } from "../schema.js";
import type { EditorAdapter } from "./editor-adapter.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface QuestionState {
  /** Visual cursor position — where the highlight is, NOT the answer */
  cursorIndex: number;
  /** Single-select: explicitly chosen option index; null = nothing chosen yet */
  selectedIndex: number | null;
  /** For multi: set of explicitly selected option indices */
  selectedIndices: Set<number>;
  /** Whether the user has confirmed this question */
  confirmed: boolean;
  /** Free-text answer typed by the user; null = free-text not chosen */
  freeTextValue: string | null;
  /** Whether the inline Editor is currently active */
  inEditMode: boolean;
}

export type DisplayOption = Option & { isOther?: true };

// ── Factory ──────────────────────────────────────────────────────────────────

export function createInitialStates(questions: Question[]): QuestionState[] {
  return questions.map(() => ({
    cursorIndex: 0,
    selectedIndex: null,
    selectedIndices: new Set<number>(),
    confirmed: false,
    freeTextValue: null,
    inEditMode: false,
  }));
}

// ── Derived helpers (pure) ───────────────────────────────────────────────────

export function getOptions(q: Question): DisplayOption[] {
  return [
    ...q.options,
    { label: "Type your own answer...", isOther: true as const },
  ];
}

export function allConfirmed(states: QuestionState[]): boolean {
  return states.every((s) => s.confirmed);
}

/**
 * Return a human-readable answer string for a confirmed question.
 * Returns null when the question is unconfirmed.
 */
export function getAnswerText(
  q: Question,
  state: QuestionState,
): string | null {
  if (!state.confirmed) {
    return null;
  }
  if (q.multi) {
    const labels = [...state.selectedIndices]
      .sort((a, b) => a - b)
      .map((idx) => q.options[idx]?.label)
      .filter((l): l is string => l !== undefined);
    if (state.freeTextValue !== null) {
      labels.push(state.freeTextValue);
    }
    return labels.join(", ");
  }
  if (state.freeTextValue !== null) {
    return state.freeTextValue;
  }
  if (state.selectedIndex !== null) {
    return q.options[state.selectedIndex]?.label ?? null;
  }
  return null;
}

// ── Mutations (mutate in place — convention matches TUI patterns) ────────────

export function moveCursor(
  state: QuestionState,
  delta: -1 | 1,
  optionCount: number,
): void {
  state.cursorIndex = Math.max(
    0,
    Math.min(optionCount - 1, state.cursorIndex + delta),
  );
}

export function toggleSelected(state: QuestionState, index: number): void {
  if (state.selectedIndices.has(index)) {
    state.selectedIndices.delete(index);
  } else {
    state.selectedIndices.add(index);
  }
  // If all answers removed, un-confirm so Submit tab blocks correctly
  if (state.selectedIndices.size === 0 && state.freeTextValue === null) {
    state.confirmed = false;
  }
}

export function selectOption(state: QuestionState, index: number): void {
  state.selectedIndex = index;
  state.freeTextValue = null;
}

export function enterEditMode(
  state: QuestionState,
  editor: EditorAdapter,
): void {
  state.inEditMode = true;
  if (state.freeTextValue !== null) {
    editor.setText(state.freeTextValue);
  } else {
    editor.setText("");
  }
}

export function exitEditMode(
  state: QuestionState,
  editor: EditorAdapter,
  save: boolean,
): void {
  if (save) {
    state.freeTextValue = editor.getText().trim();
    // Free-text replaces any prior regular-option selection
    state.selectedIndex = null;
  } else if (!state.confirmed) {
    // Discard typed text only if the answer was never confirmed
    state.freeTextValue = null;
  }
  editor.setText("");
  state.inEditMode = false;
}

export function autoConfirmIfAnswered(state: QuestionState, q: Question): void {
  if (state.confirmed) {
    return;
  }
  if (q.multi) {
    if (state.selectedIndices.size > 0 || state.freeTextValue !== null) {
      state.confirmed = true;
    }
  } else {
    if (state.freeTextValue !== null || state.selectedIndex !== null) {
      state.confirmed = true;
    }
  }
}

export function confirm(state: QuestionState): void {
  state.confirmed = true;
}

/**
 * Clear free-text value and un-confirm if no other selections exist.
 * Used when the user submits empty text in the editor.
 */
export function clearFreeTextAndUnconfirmIfNeeded(
  state: QuestionState,
  q: Question,
): void {
  state.freeTextValue = null;
  if (q.multi) {
    if (state.selectedIndices.size === 0) {
      state.confirmed = false;
    }
  } else if (state.selectedIndex === null) {
    state.confirmed = false;
  }
}

// ── Result builder (pure) ────────────────────────────────────────────────────

export function buildResult(
  questions: Question[],
  states: QuestionState[],
): AskResult {
  const answers: Record<string, string> = {};
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const s = states[i];
    if (!q || !s) {
      continue;
    }
    const text = getAnswerText(q, s);
    if (text !== null) {
      answers[q.question] = text;
    }
  }
  return { questions, answers, cancelled: false };
}
