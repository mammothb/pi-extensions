import { KeybindingsManager } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { handleInput, type InputDeps } from "../src/lib/input-handler.js";
import { PI_ASK_KEYBINDINGS } from "../src/lib/keybindings.js";
import { createInitialStates, getOptions } from "../src/lib/state.js";
import { makeMultiQuestion, makeQuestion } from "./_helpers.js";

// Raw terminal escape sequences for letter keys used in hjkl
const RAW_LETTERS = {
  h: "h",
  j: "j",
  k: "k",
  l: "l",
};

// Raw terminal escape sequences that matchesKey recognizes
const RAW = {
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  space: " ",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

function makeKb(): KeybindingsManager {
  return new KeybindingsManager(PI_ASK_KEYBINDINGS);
}

function makeCtx(overrides: Partial<InputDeps> = {}): InputDeps {
  const questions = overrides.questions ?? [makeQuestion()];
  const states = overrides.states ?? createInitialStates(questions);
  return {
    questions,
    states,
    activeTab: 0,
    isSingle: questions.length === 1,
    totalTabs: questions.length + 1,
    editor: null,
    kb: overrides.kb ?? makeKb(),
    onMoveCursor: vi.fn(),
    onToggleSelected: vi.fn(),
    onSelectOption: vi.fn(),
    onEnterEditMode: vi.fn(),
    onExitEditMode: vi.fn(),
    onClearFreeTextAndUnconfirmIfNeeded: vi.fn(),
    onAutoConfirmIfAnswered: vi.fn(),
    onConfirmAndAdvance: vi.fn(),
    onChangeTab: vi.fn(),
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onRequestRender: vi.fn(),
    ...overrides,
  };
}

// ── Submit tab ─────────────────────────────────────────────────────────────

describe("handleInput — submit tab", () => {
  it("calls onSubmit on Enter when all confirmed", () => {
    const q = makeQuestion();
    const states = createInitialStates([q]);
    const ctx = makeCtx({
      questions: [q],
      states,
      activeTab: 1, // Submit tab
      isSingle: false,
    });
    handleInput(RAW.enter, ctx);
    expect(ctx.onSubmit).toHaveBeenCalled();
  });

  it("calls onCancel on Escape", () => {
    const ctx = makeCtx({ activeTab: 1, isSingle: false });
    handleInput(RAW.escape, ctx);
    expect(ctx.onCancel).toHaveBeenCalled();
  });

  it("calls onChangeTab(0) on right arrow", () => {
    const ctx = makeCtx({ activeTab: 1, isSingle: false });
    handleInput(RAW.right, ctx);
    expect(ctx.onChangeTab).toHaveBeenCalledWith(0);
  });

  it("calls onChangeTab to last question on left arrow", () => {
    const qs = [makeQuestion(), makeQuestion()];
    const ctx = makeCtx({
      questions: qs,
      states: createInitialStates(qs),
      activeTab: 2, // Submit tab
      isSingle: false,
      totalTabs: 3,
    });
    handleInput(RAW.left, ctx);
    expect(ctx.onChangeTab).toHaveBeenCalledWith(1);
  });
});

// ── Edit mode ──────────────────────────────────────────────────────────────

describe("handleInput — edit mode", () => {
  it("exits edit mode without saving on Escape", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.inEditMode = true;
    const ctx = makeCtx({ states: [state] });
    handleInput(RAW.escape, ctx);
    expect(ctx.onExitEditMode).toHaveBeenCalledWith(false);
  });

  it("saves and confirms on Enter with text (single-select)", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.inEditMode = true;
    const editor = {
      getText: () => "hello",
      setText: () => {},
      handleInput: () => {},
      render: () => [] as string[],
    };
    const ctx = makeCtx({ questions: [q], states: [state], editor });
    handleInput(RAW.enter, ctx);
    expect(ctx.onExitEditMode).toHaveBeenCalledWith(true);
    expect(ctx.onConfirmAndAdvance).toHaveBeenCalled();
  });

  it("saves but does not confirm on Enter with text for multi-select", () => {
    const q = makeMultiQuestion();
    const [state] = createInitialStates([q]);
    state.inEditMode = true;
    const editor = {
      getText: () => "hello",
      setText: () => {},
      handleInput: () => {},
      render: () => [] as string[],
    };
    const ctx = makeCtx({ questions: [q], states: [state], editor });
    handleInput(RAW.enter, ctx);
    expect(ctx.onExitEditMode).toHaveBeenCalledWith(true);
    expect(ctx.onConfirmAndAdvance).not.toHaveBeenCalled();
    expect(ctx.onRequestRender).toHaveBeenCalled();
  });

  it("clears and exits on Enter with empty text", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.inEditMode = true;
    const editor = {
      getText: () => "",
      setText: () => {},
      handleInput: () => {},
      render: () => [] as string[],
    };
    const ctx = makeCtx({ questions: [q], states: [state], editor });
    handleInput(RAW.enter, ctx);
    expect(ctx.onClearFreeTextAndUnconfirmIfNeeded).toHaveBeenCalled();
    expect(ctx.onExitEditMode).toHaveBeenCalledWith(false);
  });

  it("delegates other keys to editor", () => {
    const [state] = createInitialStates([makeQuestion()]);
    state.inEditMode = true;
    const editor = {
      getText: () => "",
      setText: () => {},
      handleInput: vi.fn(),
      render: () => [] as string[],
    };
    const ctx = makeCtx({ states: [state], editor });
    handleInput("a", ctx);
    expect(editor.handleInput).toHaveBeenCalledWith("a");
  });
});

// ── Question tab ───────────────────────────────────────────────────────────

describe("handleInput — question tab", () => {
  it("calls onCancel on Escape", () => {
    const ctx = makeCtx();
    handleInput(RAW.escape, ctx);
    expect(ctx.onCancel).toHaveBeenCalled();
  });

  it("auto-confirms and moves to next tab on right arrow (multi-question)", () => {
    const qs = [makeQuestion(), makeQuestion()];
    const ctx = makeCtx({
      questions: qs,
      states: createInitialStates(qs),
      isSingle: false,
      totalTabs: 3,
    });
    handleInput(RAW.right, ctx);
    expect(ctx.onAutoConfirmIfAnswered).toHaveBeenCalled();
    expect(ctx.onChangeTab).toHaveBeenCalledWith(1);
  });

  it("moves to prev tab on left arrow with wrap", () => {
    const qs = [makeQuestion(), makeQuestion()];
    const ctx = makeCtx({
      questions: qs,
      states: createInitialStates(qs),
      isSingle: false,
      totalTabs: 3,
    });
    handleInput(RAW.left, ctx);
    expect(ctx.onChangeTab).toHaveBeenCalledWith(2); // wraps to Submit tab
  });

  it("moves cursor up on up arrow", () => {
    const ctx = makeCtx();
    handleInput(RAW.up, ctx);
    expect(ctx.onMoveCursor).toHaveBeenCalledWith(-1);
  });

  it("moves cursor down on down arrow", () => {
    const ctx = makeCtx();
    handleInput(RAW.down, ctx);
    expect(ctx.onMoveCursor).toHaveBeenCalledWith(1);
  });

  it("enters edit mode on Space when cursor on Other", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.cursorIndex = getOptions(q).length - 1; // on "Other"
    const ctx = makeCtx({ questions: [q], states: [state] });
    handleInput(RAW.space, ctx);
    expect(ctx.onEnterEditMode).toHaveBeenCalled();
  });

  it("enters edit mode on Tab when cursor on Other", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.cursorIndex = getOptions(q).length - 1;
    const ctx = makeCtx({ questions: [q], states: [state] });
    handleInput(RAW.tab, ctx);
    expect(ctx.onEnterEditMode).toHaveBeenCalled();
  });

  it("confirms on Enter when cursor on Other with saved free-text", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.cursorIndex = getOptions(q).length - 1;
    state.freeTextValue = "saved";
    const ctx = makeCtx({ questions: [q], states: [state] });
    handleInput(RAW.enter, ctx);
    expect(ctx.onConfirmAndAdvance).toHaveBeenCalled();
  });

  it("toggles selection on Space for multi-select (not on Other)", () => {
    const q = makeMultiQuestion();
    const [state] = createInitialStates([q]);
    state.cursorIndex = 0; // not on "Other"
    const ctx = makeCtx({ questions: [q], states: [state] });
    handleInput(RAW.space, ctx);
    expect(ctx.onToggleSelected).toHaveBeenCalledWith(0);
  });

  it("confirms on Enter for multi when selections exist", () => {
    const q = makeMultiQuestion();
    const [state] = createInitialStates([q]);
    state.cursorIndex = 0;
    state.selectedIndices.add(0);
    const ctx = makeCtx({ questions: [q], states: [state] });
    handleInput(RAW.enter, ctx);
    expect(ctx.onConfirmAndAdvance).toHaveBeenCalled();
  });

  it("confirms on Enter for single-select", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.cursorIndex = 1;
    const ctx = makeCtx({ questions: [q], states: [state] });
    handleInput(RAW.enter, ctx);
    expect(ctx.onSelectOption).toHaveBeenCalledWith(1);
    expect(ctx.onConfirmAndAdvance).toHaveBeenCalled();
  });

  // ── Vim-style hjkl navigation ─────────────────────────────────────────

  it("moves cursor up on k", () => {
    const ctx = makeCtx();
    handleInput(RAW_LETTERS.k, ctx);
    expect(ctx.onMoveCursor).toHaveBeenCalledWith(-1);
  });

  it("moves cursor down on j", () => {
    const ctx = makeCtx();
    handleInput(RAW_LETTERS.j, ctx);
    expect(ctx.onMoveCursor).toHaveBeenCalledWith(1);
  });

  it("moves to next tab on l (multi-question)", () => {
    const qs = [makeQuestion(), makeQuestion()];
    const ctx = makeCtx({
      questions: qs,
      states: createInitialStates(qs),
      isSingle: false,
      totalTabs: 3,
    });
    handleInput(RAW_LETTERS.l, ctx);
    expect(ctx.onChangeTab).toHaveBeenCalledWith(1);
  });

  it("moves to prev tab on h (multi-question)", () => {
    const qs = [makeQuestion(), makeQuestion()];
    const ctx = makeCtx({
      questions: qs,
      states: createInitialStates(qs),
      isSingle: false,
      totalTabs: 3,
    });
    handleInput(RAW_LETTERS.h, ctx);
    expect(ctx.onChangeTab).toHaveBeenCalledWith(2); // wraps to Submit
  });

  // ── Custom keybinding overrides ────────────────────────────────────────

  it("uses custom user keybinding when configured", () => {
    const kb = new KeybindingsManager(PI_ASK_KEYBINDINGS, {
      "pi-ask.cursorUp": "w",
    });
    const ctx = makeCtx({ kb });
    // Arrow up is no longer bound (overridden by user config)
    handleInput(RAW.up, ctx);
    expect(ctx.onMoveCursor).not.toHaveBeenCalled();
    // 'w' is now cursor up
    handleInput("w", ctx);
    expect(ctx.onMoveCursor).toHaveBeenCalledWith(-1);
  });

  it("supports multiple custom keys per binding", () => {
    const kb = new KeybindingsManager(PI_ASK_KEYBINDINGS, {
      "pi-ask.cursorDown": ["j", "down"],
    });
    const ctx = makeCtx({ kb });
    handleInput(RAW_LETTERS.j, ctx);
    expect(ctx.onMoveCursor).toHaveBeenCalledWith(1);

    const ctx2 = makeCtx({ kb });
    handleInput(RAW.down, ctx2);
    expect(ctx2.onMoveCursor).toHaveBeenCalledWith(1);
  });

  it("returns false for unhandled keys", () => {
    const ctx = makeCtx();
    expect(handleInput("x", ctx)).toBe(false);
  });
});
