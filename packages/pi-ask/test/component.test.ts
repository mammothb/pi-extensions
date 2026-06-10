import { KeybindingsManager } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { AskComponent } from "../src/lib/component.js";
import {
  createAskKeybindings,
  PI_ASK_KEYBINDINGS,
} from "../src/lib/keybindings.js";
import type { AskResult } from "../src/schema.js";
import {
  createMockTheme,
  makeMultiQuestion,
  makeQuestion,
} from "./_helpers.js";

// Raw terminal escape sequences that matchesKey recognizes
const RAW = {
  enter: "\r",
  escape: "\x1b",
  space: " ",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

function stubTui() {
  return { requestRender: () => {} } as never;
}

function makeKb(): KeybindingsManager {
  return new KeybindingsManager(PI_ASK_KEYBINDINGS);
}

function newComponent(
  questions = [makeQuestion()],
  overrides?: {
    theme?: ReturnType<typeof createMockTheme>;
    kb?: KeybindingsManager;
  },
) {
  const done = vi.fn<(result: AskResult | null) => void>();
  const component = new AskComponent(
    questions,
    stubTui(),
    overrides?.theme ?? createMockTheme(),
    done,
    overrides?.kb ?? makeKb(),
  );
  return { component, done };
}

// ── Keybindings ────────────────────────────────────────────────────────────

describe("createAskKeybindings", () => {
  it("returns a KeybindingsManager with pi-ask bindings merged", () => {
    const kb = createAskKeybindings();
    expect(kb.matches("j", "pi-ask.cursorDown")).toBe(true);
    expect(kb.matches("k", "pi-ask.cursorUp")).toBe(true);
    expect(kb.matches("h", "pi-ask.prevTab")).toBe(true);
    expect(kb.matches("l", "pi-ask.nextTab")).toBe(true);
  });

  it("respects user overrides", () => {
    const kb = createAskKeybindings({ "pi-ask.cursorDown": "x" });
    expect(kb.matches("x", "pi-ask.cursorDown")).toBe(true);
  });
});

// ── Single question flow ───────────────────────────────────────────────────

describe("AskComponent — single question", () => {
  it("confirms on Enter/Space and calls done with result", () => {
    const q = makeQuestion();
    const { component, done } = newComponent([q]);

    // Navigate to Option B (index 1)
    component.handleInput(RAW.down);
    // Select + confirm
    component.handleInput(RAW.enter);

    expect(done).toHaveBeenCalledTimes(1);
    const result = done.mock.calls[0]![0]!;
    expect(result.cancelled).toBe(false);
    expect(result.answers[q.question]).toBe("Option B");
  });

  it("calls done(null) on Escape", () => {
    const { component, done } = newComponent();

    component.handleInput(RAW.escape);

    expect(done).toHaveBeenCalledWith(null);
  });

  it("selects the first option at cursor 0 with Enter", () => {
    const q = makeQuestion();
    const { component, done } = newComponent([q]);

    // Cursor defaults to index 0 (Option A)
    component.handleInput(RAW.enter);

    const result = done.mock.calls[0]![0]!;
    expect(result.answers[q.question]).toBe("Option A");
  });

  it("selects via Space", () => {
    const q = makeQuestion();
    const { component, done } = newComponent([q]);

    component.handleInput(RAW.down); // cursor to Option B
    component.handleInput(RAW.space); // select + confirm

    const result = done.mock.calls[0]![0]!;
    expect(result.answers[q.question]).toBe("Option B");
  });
});

// ── Cancel ─────────────────────────────────────────────────────────────────

describe("AskComponent — cancel", () => {
  it("calls done(null) on Escape from any tab", () => {
    const qs = [makeQuestion({ header: "A" }), makeQuestion({ header: "B" })];
    const { component, done } = newComponent(qs);

    component.handleInput(RAW.escape);
    expect(done).toHaveBeenCalledWith(null);
  });

  it("ignores input after cancel", () => {
    const { component, done } = newComponent();

    component.handleInput(RAW.escape);
    expect(done).toHaveBeenCalledTimes(1);

    // Subsequent input should be ignored
    component.handleInput(RAW.enter);
    component.handleInput(RAW.down);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

// ── Multi question flow ────────────────────────────────────────────────────

describe("AskComponent — multi question", () => {
  it("confirms Q1, auto-advances, confirms Q2, lands on Submit, Enter submits", () => {
    const q1 = makeQuestion({ header: "First", question: "Q1?" });
    const q2 = makeQuestion({ header: "Second", question: "Q2?" });
    const { component, done } = newComponent([q1, q2]);

    // Q1: select Option A (cursor at 0)
    component.handleInput(RAW.enter); // confirm Q1

    // Should have auto-advanced to Q2
    // Q2: navigate down to Option B, then Enter
    component.handleInput(RAW.down); // cursor to index 1
    component.handleInput(RAW.enter); // confirm Q2

    // Should have auto-advanced to Submit tab (index 2)
    // Submit: Enter
    component.handleInput(RAW.enter);

    expect(done).toHaveBeenCalledTimes(1);
    const result = done.mock.calls[0]![0]!;
    expect(result.cancelled).toBe(false);
    expect(result.answers[q1.question]).toBe("Option A");
    expect(result.answers[q2.question]).toBe("Option B");
  });

  it("tab navigation with right/left arrows", () => {
    const q1 = makeQuestion({ header: "First" });
    const q2 = makeQuestion({ header: "Second" });
    const { component } = newComponent([q1, q2]);

    // Q1 is active; confirm Q1 first so we can navigate freely
    component.handleInput(RAW.enter); // confirms Q1, auto-advances to Q2

    // Now on Q2. Press right to go to Submit tab
    component.handleInput(RAW.right);

    // Verify we're on Submit tab: pressing Escape there cancels
    // Use a fresh component + done to check cancel from Submit tab
    const qs = [makeQuestion({ header: "A" }), makeQuestion({ header: "B" })];
    const { component: c2, done: d2 } = newComponent(qs);

    // Navigate to Submit tab directly
    c2.handleInput(RAW.right); // to Q2 (auto-confirms Q1)
    c2.handleInput(RAW.right); // to Submit
    c2.handleInput(RAW.escape); // cancel from Submit

    expect(d2).toHaveBeenCalledWith(null);
  });

  it("wraps from Submit tab back to Q1 with right arrow", () => {
    const q1 = makeQuestion({ header: "First" });
    const q2 = makeQuestion({ header: "Second" });
    const { component } = newComponent([q1, q2]);

    // Q1 → Q2 → Submit (via right arrows, auto-confirming)
    component.handleInput(RAW.right); // to Q2
    component.handleInput(RAW.right); // to Submit
    // Submit → Q1 (wrap)
    component.handleInput(RAW.right);

    // Now on Q1. Confirm with Enter (should advance to Q2)
    // But Q1 is already confirmed, so pressing Enter should advance
    component.handleInput(RAW.up); // move cursor
    component.handleInput(RAW.down); // move back
    component.handleInput(RAW.enter); // re-confirm Q1, advance to Q2
  });
});

// ── Render output ──────────────────────────────────────────────────────────

describe("AskComponent — render", () => {
  it("returns lines for a single question", () => {
    const { component } = newComponent([makeQuestion()]);
    const lines = component.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("[accent]");
  });

  it("returns same array on repeated render with same width", () => {
    const { component } = newComponent([makeQuestion()]);
    const lines1 = component.render(80);
    const lines2 = component.render(80);
    expect(lines2).toBe(lines1);
  });

  it("invalidates cache when width changes", () => {
    const { component } = newComponent([makeQuestion()]);
    const lines1 = component.render(80);
    const lines2 = component.render(60);
    expect(lines2).not.toBe(lines1);
  });

  it("invalidates cache after handleInput", () => {
    const { component } = newComponent([makeQuestion()]);
    const lines1 = component.render(80);
    component.handleInput(RAW.down); // moves cursor, invalidates
    const lines2 = component.render(80);
    expect(lines2).not.toBe(lines1);
  });
});

// ── Multi select ───────────────────────────────────────────────────────────

describe("AskComponent — multi select", () => {
  it("toggles selections with Space and confirms with Enter", () => {
    const q = makeMultiQuestion();
    const { component, done } = newComponent([q]);

    // Toggle Option A (index 0)
    component.handleInput(RAW.space);
    // Navigate to Option C (index 2)
    component.handleInput(RAW.down);
    component.handleInput(RAW.down);
    // Toggle Option C
    component.handleInput(RAW.space);
    // Confirm
    component.handleInput(RAW.enter);

    const result = done.mock.calls[0]![0]!;
    expect(result.answers[q.question]).toBe("Option A, Option C");
  });

  it("does not confirm on Enter when nothing selected", () => {
    const q = makeMultiQuestion();
    const { component, done } = newComponent([q]);

    // Press Enter with no selections
    component.handleInput(RAW.enter);

    // Should not have called done (nothing confirmed)
    expect(done).not.toHaveBeenCalled();
  });

  it("auto-advances single multi-question on confirm", () => {
    const q = makeMultiQuestion();
    const { component, done } = newComponent([q]);

    // Toggle and confirm
    component.handleInput(RAW.space); // toggle Option A
    component.handleInput(RAW.enter); // confirm → submit (single question)

    expect(done).toHaveBeenCalledTimes(1);
  });
});

// ── Free-text editor ───────────────────────────────────────────────────────

describe("AskComponent — free-text editor", () => {
  it("enters edit mode on Space when cursor on Other (callbacks wired)", () => {
    const q = makeQuestion();
    const { component } = newComponent([q]);

    // Navigate to the last option ("Type your own answer...")
    component.handleInput(RAW.down); // index 1
    component.handleInput(RAW.down); // index 2
    component.handleInput(RAW.down); // index 3 (Other)

    // Space on "Other" enters edit mode — the input handler invokes
    // onEnterEditMode which calls enterEditMode + invalidate + requestRender.
    // Verify it doesn't throw (the callback is wired).
    // We can't render because the stub TUI doesn't support the real Editor.
    expect(() => component.handleInput(RAW.space)).not.toThrow();
  });

  it("exits edit mode on Escape (discard)", () => {
    const q = makeQuestion();
    const { component } = newComponent([q]);

    // Enter edit mode
    component.handleInput(RAW.down);
    component.handleInput(RAW.down);
    component.handleInput(RAW.down);
    component.handleInput(RAW.space);

    // Escape exits edit mode (discard) — callback wired to onExitEditMode
    expect(() => component.handleInput(RAW.escape)).not.toThrow();
  });

  it("ignores Enter on Other when no free-text saved", () => {
    const q = makeQuestion();
    const { component, done } = newComponent([q]);

    // Navigate to Other, Enter with no saved free-text is a no-op
    component.handleInput(RAW.down);
    component.handleInput(RAW.down);
    component.handleInput(RAW.down);
    component.handleInput(RAW.enter);

    expect(done).not.toHaveBeenCalled();
  });
});

// ── Submit tab edge cases ──────────────────────────────────────────────────

describe("AskComponent — submit tab", () => {
  it("does not submit when Enter pressed but not all questions confirmed", () => {
    const q1 = makeQuestion({ header: "A", question: "Q1?" });
    const q2 = makeQuestion({ header: "B", question: "Q2?" });
    const { component, done } = newComponent([q1, q2]);

    // Navigate to Submit tab without confirming anything
    component.handleInput(RAW.right); // to Q2 (auto-confirms Q1 since cursor is on Option A)
    component.handleInput(RAW.right); // to Submit tab

    // Q2 is unconfirmed. Pressing Enter on Submit tab is a no-op.
    component.handleInput(RAW.enter);
    expect(done).not.toHaveBeenCalled();
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe("AskComponent — edge cases", () => {
  it("renders empty lines for zero questions", () => {
    const { component } = newComponent([]);
    const lines = component.render(80);
    expect(lines).toEqual([]);
  });

  it("submits immediately on Enter with empty questions", () => {
    // The component doesn't guard against empty questions — execute() does.
    // With zero questions, allConfirmed is vacuously true, so Enter submits.
    const { component, done } = newComponent([]);

    component.handleInput(RAW.enter);

    expect(done).toHaveBeenCalledTimes(1);
    const result = done.mock.calls[0]![0]!;
    expect(result.questions).toEqual([]);
    expect(result.cancelled).toBe(false);
  });
});
