import { describe, expect, it } from "vitest";
import {
  autoConfirmIfAnswered,
  buildResult,
  clearFreeTextAndUnconfirmIfNeeded,
  confirm,
  createInitialStates,
  enterEditMode,
  exitEditMode,
  getAnswerText,
  moveCursor,
  selectOption,
  toggleSelected,
} from "../src/lib/state.js";
import { makeMultiQuestion, makeQuestion } from "./_helpers.js";

// Stub editor adapter for tests that need one
function stubEditor(text = ""): {
  getText: () => string;
  setText: (t: string) => void;
  handleInput: (_: string) => void;
  render: (_: number) => string[];
} {
  let current = text;
  return {
    getText: () => current,
    setText: (t: string) => {
      current = t;
    },
    handleInput: () => {},
    render: () => [],
  };
}

// ── createInitialStates ────────────────────────────────────────────────────

describe("createInitialStates", () => {
  it("returns one state per question", () => {
    const states = createInitialStates([makeQuestion(), makeQuestion()]);
    expect(states).toHaveLength(2);
  });

  it("initializes cursorIndex to 0", () => {
    const [state] = createInitialStates([makeQuestion()]);
    expect(state.cursorIndex).toBe(0);
  });

  it("has no selections or confirmation", () => {
    const [state] = createInitialStates([makeQuestion()]);
    expect(state.selectedIndex).toBeNull();
    expect(state.selectedIndices.size).toBe(0);
    expect(state.confirmed).toBe(false);
    expect(state.freeTextValue).toBeNull();
    expect(state.inEditMode).toBe(false);
  });
});

// ── moveCursor ─────────────────────────────────────────────────────────────

describe("moveCursor", () => {
  it("moves cursor down within bounds", () => {
    const [state] = createInitialStates([makeQuestion()]);
    moveCursor(state, 1, 4); // 3 options + "other"
    expect(state.cursorIndex).toBe(1);
  });

  it("clamps to 0 at top", () => {
    const [state] = createInitialStates([makeQuestion()]);
    moveCursor(state, -1, 4);
    expect(state.cursorIndex).toBe(0);
  });

  it("clamps to optionCount-1 at bottom", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.cursorIndex = 3;
    moveCursor(state, 1, 4);
    expect(state.cursorIndex).toBe(3);
  });
});

// ── toggleSelected ─────────────────────────────────────────────────────────

describe("toggleSelected", () => {
  it("adds index to selectedIndices when not present", () => {
    const [state] = createInitialStates([makeQuestion()]);
    toggleSelected(state, 0);
    expect(state.selectedIndices.has(0)).toBe(true);
  });

  it("removes index from selectedIndices when present", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.selectedIndices.add(1);
    toggleSelected(state, 1);
    expect(state.selectedIndices.has(1)).toBe(false);
  });

  it("unconfirms if all selections removed and no free-text", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.confirmed = true;
    state.selectedIndices.add(0);
    toggleSelected(state, 0);
    expect(state.confirmed).toBe(false);
  });

  it("keeps confirmed if free-text exists even when all indices removed", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.confirmed = true;
    state.freeTextValue = "custom";
    state.selectedIndices.add(0);
    toggleSelected(state, 0);
    expect(state.confirmed).toBe(true);
  });
});

// ── selectOption ───────────────────────────────────────────────────────────

describe("selectOption", () => {
  it("sets selectedIndex and clears freeTextValue", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.freeTextValue = "old custom";
    selectOption(state, 2);
    expect(state.selectedIndex).toBe(2);
    expect(state.freeTextValue).toBeNull();
  });
});

// ── enterEditMode / exitEditMode ───────────────────────────────────────────

describe("enterEditMode", () => {
  it("sets inEditMode and clears editor", () => {
    const [state] = createInitialStates([makeQuestion()]);
    const editor = stubEditor("some text");
    enterEditMode(state, editor);
    expect(state.inEditMode).toBe(true);
    expect(editor.getText()).toBe("");
  });

  it("restores previous free-text value", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.freeTextValue = "saved answer";
    const editor = stubEditor();
    enterEditMode(state, editor);
    expect(editor.getText()).toBe("saved answer");
  });
});

describe("exitEditMode", () => {
  it("saves editor text to freeTextValue on save=true", () => {
    const [state] = createInitialStates([makeQuestion()]);
    const editor = stubEditor("  typed answer  ");
    state.inEditMode = true;
    exitEditMode(state, editor, true);
    expect(state.freeTextValue).toBe("typed answer");
    expect(state.inEditMode).toBe(false);
    expect(state.selectedIndex).toBeNull();
  });

  it("discards typed text on save=false when unconfirmed", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.freeTextValue = "temp";
    state.inEditMode = true;
    const editor = stubEditor("garbage");
    exitEditMode(state, editor, false);
    expect(state.freeTextValue).toBeNull();
    expect(state.inEditMode).toBe(false);
  });

  it("preserves freeTextValue on save=false when confirmed", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.freeTextValue = "confirmed answer";
    state.confirmed = true;
    state.inEditMode = true;
    const editor = stubEditor();
    exitEditMode(state, editor, false);
    expect(state.freeTextValue).toBe("confirmed answer");
  });
});

// ── autoConfirmIfAnswered ─────────────────────────────────────────────────

describe("autoConfirmIfAnswered", () => {
  it("confirms single-select when selectedIndex is set", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.selectedIndex = 1;
    autoConfirmIfAnswered(state, makeQuestion());
    expect(state.confirmed).toBe(true);
  });

  it("confirms single-select when freeTextValue is set", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.freeTextValue = "custom";
    autoConfirmIfAnswered(state, makeQuestion());
    expect(state.confirmed).toBe(true);
  });

  it("confirms multi-select when at least one index selected", () => {
    const [state] = createInitialStates([makeMultiQuestion()]);
    state.selectedIndices.add(0);
    autoConfirmIfAnswered(state, makeMultiQuestion());
    expect(state.confirmed).toBe(true);
  });

  it("does not confirm when nothing selected", () => {
    const [state] = createInitialStates([makeQuestion()]);
    autoConfirmIfAnswered(state, makeQuestion());
    expect(state.confirmed).toBe(false);
  });

  it("skips if already confirmed", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.confirmed = true;
    state.selectedIndex = null;
    autoConfirmIfAnswered(state, makeQuestion());
    expect(state.confirmed).toBe(true); // stays true
  });
});

// ── confirm ────────────────────────────────────────────────────────────────

describe("confirm", () => {
  it("sets confirmed to true", () => {
    const [state] = createInitialStates([makeQuestion()]);
    confirm(state);
    expect(state.confirmed).toBe(true);
  });
});

// ── clearFreeTextAndUnconfirmIfNeeded ─────────────────────────────────────

describe("clearFreeTextAndUnconfirmIfNeeded", () => {
  it("clears freeTextValue and unconfirms single-select when no option", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.freeTextValue = "custom";
    state.confirmed = true;
    clearFreeTextAndUnconfirmIfNeeded(state, makeQuestion());
    expect(state.freeTextValue).toBeNull();
    expect(state.confirmed).toBe(false);
  });

  it("clears freeTextValue and unconfirms multi when no indices", () => {
    const [state] = createInitialStates([makeMultiQuestion()]);
    state.freeTextValue = "custom";
    state.confirmed = true;
    clearFreeTextAndUnconfirmIfNeeded(state, makeMultiQuestion());
    expect(state.freeTextValue).toBeNull();
    expect(state.confirmed).toBe(false);
  });

  it("unconfirms multi when indices are empty", () => {
    const [state] = createInitialStates([makeMultiQuestion()]);
    state.confirmed = true;
    clearFreeTextAndUnconfirmIfNeeded(state, makeMultiQuestion());
    expect(state.confirmed).toBe(false);
  });

  it("does not unconfirm single when selectedIndex is set", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.selectedIndex = 0;
    state.confirmed = true;
    clearFreeTextAndUnconfirmIfNeeded(state, makeQuestion());
    expect(state.confirmed).toBe(true);
  });
});

// ── getAnswerText ──────────────────────────────────────────────────────────

describe("getAnswerText", () => {
  it("returns null when not confirmed", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.selectedIndex = 0;
    expect(getAnswerText(makeQuestion(), state)).toBeNull();
  });

  it("returns selected label for single-select", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.confirmed = true;
    state.selectedIndex = 1;
    expect(getAnswerText(makeQuestion(), state)).toBe("Option B");
  });

  it("returns comma-joined labels for multi-select", () => {
    const [state] = createInitialStates([makeMultiQuestion()]);
    state.confirmed = true;
    state.selectedIndices.add(0);
    state.selectedIndices.add(2);
    expect(getAnswerText(makeMultiQuestion(), state)).toBe(
      "Option A, Option C",
    );
  });

  it("includes free-text in multi-select result", () => {
    const [state] = createInitialStates([makeMultiQuestion()]);
    state.confirmed = true;
    state.selectedIndices.add(0);
    state.freeTextValue = "custom";
    expect(getAnswerText(makeMultiQuestion(), state)).toBe("Option A, custom");
  });

  it("returns free-text for single-select other", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.confirmed = true;
    state.freeTextValue = "my text";
    expect(getAnswerText(makeQuestion(), state)).toBe("my text");
  });
});

// ── buildResult ────────────────────────────────────────────────────────────

describe("buildResult", () => {
  it("builds single-select result", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.confirmed = true;
    state.selectedIndex = 0;

    const result = buildResult([q], [state]);
    expect(result.cancelled).toBe(false);
    expect(result.answers[q.question]).toBe("Option A");
  });

  it("builds multi-select result with comma-joined labels", () => {
    const q = makeMultiQuestion();
    const [state] = createInitialStates([q]);
    state.confirmed = true;
    state.selectedIndices.add(1);
    state.selectedIndices.add(2);

    const result = buildResult([q], [state]);
    expect(result.answers[q.question]).toBe("Option B, Option C");
  });

  it("includes free-text in multi-select result", () => {
    const q = makeMultiQuestion();
    const [state] = createInitialStates([q]);
    state.confirmed = true;
    state.selectedIndices.add(0);
    state.freeTextValue = "custom";

    const result = buildResult([q], [state]);
    expect(result.answers[q.question]).toBe("Option A, custom");
  });

  it("skips unconfirmed questions", () => {
    const q1 = makeQuestion({ question: "Q1?" });
    const q2 = makeQuestion({ question: "Q2?" });
    const [s1, s2] = createInitialStates([q1, q2]);
    s1.confirmed = true;
    s1.selectedIndex = 0;
    // s2 is unconfirmed

    const result = buildResult([q1, q2], [s1, s2]);
    expect(result.answers).toHaveProperty("Q1?");
    expect(result.answers).not.toHaveProperty("Q2?");
  });

  it("returns cancelled: false", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.confirmed = true;
    state.selectedIndex = 0;

    expect(buildResult([q], [state]).cancelled).toBe(false);
  });
});
