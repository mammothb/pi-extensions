import { describe, expect, it } from "vitest";
import {
  renderAskComponent,
  renderQuestionBody,
  renderSubmitTab,
  renderTabBar,
} from "../src/lib/renderer.js";
import { createInitialStates, getOptions } from "../src/lib/state.js";
import {
  createMockTheme,
  makeMultiQuestion,
  makeQuestion,
  optionWithDesc,
} from "./_helpers.js";

const theme = createMockTheme();

// ── renderAskComponent ─────────────────────────────────────────────────────

describe("renderAskComponent", () => {
  it("returns empty array for zero questions", () => {
    const lines = renderAskComponent([], [], 0, true, theme, 80);
    expect(lines).toEqual([]);
  });

  it("includes top and bottom separators for single question", () => {
    const q = makeQuestion();
    const states = createInitialStates([q]);
    const lines = renderAskComponent([q], states, 0, true, theme, 80);

    const first = lines[0] ?? "";
    const last = lines[lines.length - 1] ?? "";
    expect(first).toContain("[accent]");
    expect(first).toContain("─");
    expect(last).toContain("[accent]");
    expect(last).toContain("─");
  });

  it("renders tab bar for multi-question", () => {
    const q1 = makeQuestion({ header: "First" });
    const q2 = makeQuestion({ header: "Second" });
    const states = createInitialStates([q1, q2]);

    // Test renderTabBar directly to avoid truncateToWidth issues with mock tags
    const tabLines = renderTabBar([q1, q2], states, 0, theme, 80);
    const tabLine = tabLines.join("");
    expect(tabLine).toContain("First");
    expect(tabLine).toContain("Second");
    // Submit tab is rendered with [dim] styling
    expect(tabLine).toContain("[dim] Submit [/dim]");
  });

  it("skips tab bar for single question", () => {
    const q = makeQuestion();
    const states = createInitialStates([q]);
    const lines = renderAskComponent([q], states, 0, true, theme, 80);

    // Should not have "Submit" tab since single question
    expect(lines.join("")).not.toContain("Submit");
  });

  it("renders submit tab when activeTab is beyond questions", () => {
    const q1 = makeQuestion({ header: "A" });
    const q2 = makeQuestion({ header: "B" });
    const states = createInitialStates([q1, q2]);
    const lines = renderAskComponent([q1, q2], states, 2, false, theme, 80);

    // activeTab 2 = Submit tab
    expect(lines.join("")).toContain("Unanswered");
  });
});

// ── renderTabBar ───────────────────────────────────────────────────────────

describe("renderTabBar", () => {
  it("highlights active tab with selectedBg", () => {
    const q1 = makeQuestion({ header: "A" });
    const q2 = makeQuestion({ header: "B" });
    const states = createInitialStates([q1, q2]);
    const lines = renderTabBar([q1, q2], states, 0, theme, 80);

    expect(lines[0]).toContain("[bg:selectedBg]");
  });

  it("marks confirmed tabs with success color", () => {
    const q1 = makeQuestion({ header: "Done" });
    const q2 = makeQuestion({ header: "Todo" });
    const states = createInitialStates([q1, q2]);
    // Tab 1 is confirmed; activeTab=0 so Done is active (not success).
    // The confirmed color shows on non-active confirmed tabs.
    states[1]!.confirmed = true;

    const lines = renderTabBar([q1, q2], states, 0, theme, 80);
    // Tab 1 (Todo) should show [success] because it's confirmed but not active
    expect(lines[0]).toContain("[success]");
  });

  it("truncates headers to 12 characters", () => {
    const q = makeQuestion({ header: "VeryLongHeaderNameThatExceeds" });
    const states = createInitialStates([q]);
    const lines = renderTabBar([q], states, 0, theme, 80);

    // The displayed header should be at most 12 chars + 2 spaces
    expect(lines[0]).not.toContain("VeryLongHeaderNameThatExceeds");
  });
});

// ── renderQuestionBody ─────────────────────────────────────────────────────

describe("renderQuestionBody", () => {
  it("renders question text", () => {
    const q = makeQuestion({ question: "Hello world?" });
    const [state] = createInitialStates([q]);

    const lines = renderQuestionBody(q, state, true, theme, 80);
    expect(lines.join("")).toContain("Hello world?");
  });

  it("renders single-select options with cursor marker", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);

    const lines = renderQuestionBody(q, state, true, theme, 80);
    // The first option (cursor at 0) should have the accent cursor
    expect(lines.join("")).toContain("[accent]>");
  });

  it("renders multi-select options with checkbox markers", () => {
    const q = makeMultiQuestion();
    const [state] = createInitialStates([q]);

    const lines = renderQuestionBody(q, state, true, theme, 80);
    // All options should have checkbox brackets
    expect(lines.join("")).toContain("[ ]");
  });

  it("shows ✓ on confirmed single-select choice", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.confirmed = true;
    state.selectedIndex = 1; // Option B is selected

    const lines = renderQuestionBody(q, state, true, theme, 80);
    // The rendered Option B row should show the success checkmark
    expect(lines.join("")).toContain("[success]");
  });

  it("shows [x] on selected multi-select choices", () => {
    const q = makeMultiQuestion();
    const [state] = createInitialStates([q]);
    state.selectedIndices.add(0);

    const lines = renderQuestionBody(q, state, true, theme, 80);
    expect(lines.join("")).toContain("[accent][x]");
  });

  it("includes 'Type your own answer...' option", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);

    const lines = renderQuestionBody(q, state, true, theme, 80);
    expect(lines.join("")).toContain("Type your own answer");
  });

  it("shows free-text preview when saved", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.freeTextValue = "my custom answer";
    state.cursorIndex = getOptions(q).length - 1; // cursor on "other"

    const lines = renderQuestionBody(q, state, true, theme, 80);
    expect(lines.join("")).toContain("my custom answer");
  });

  it("renders option descriptions", () => {
    const q = makeQuestion({
      options: [optionWithDesc("A", "First choice description")],
    });
    const [state] = createInitialStates([q]);

    const lines = renderQuestionBody(q, state, true, theme, 80);
    expect(lines.join("")).toContain("First choice description");
  });

  it("renders context-sensitive footer in normal mode", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);

    const lines = renderQuestionBody(q, state, true, theme, 80);
    const footer = lines.join("");
    expect(footer).toContain("navigate");
  });

  it("renders edit-mode footer when inEditMode", () => {
    const q = makeQuestion();
    const [state] = createInitialStates([q]);
    state.inEditMode = true;

    const lines = renderQuestionBody(q, state, true, theme, 80);
    expect(lines.join("")).toContain("Enter submit");
  });
});

// ── renderSubmitTab ────────────────────────────────────────────────────────

describe("renderSubmitTab", () => {
  it("shows 'Ready to submit' when all confirmed", () => {
    const q = makeQuestion();
    const states = createInitialStates([q]);
    states[0]!.confirmed = true;

    const lines = renderSubmitTab([q], states, theme, 80);
    expect(lines.join("")).toContain("Ready to submit");
  });

  it("shows 'Unanswered questions' when some unconfirmed", () => {
    const q1 = makeQuestion({ header: "A" });
    const q2 = makeQuestion({ header: "B" });
    const states = createInitialStates([q1, q2]);
    states[0]!.confirmed = true;
    // states[1] is unconfirmed

    const lines = renderSubmitTab([q1, q2], states, theme, 80);
    expect(lines.join("")).toContain("Unanswered");
  });

  it("lists answers for confirmed questions", () => {
    const q = makeQuestion();
    const states = createInitialStates([q]);
    states[0]!.confirmed = true;
    states[0]!.selectedIndex = 0;

    const lines = renderSubmitTab([q], states, theme, 80);
    expect(lines.join("")).toContain("Option A");
  });

  it("shows dash for unconfirmed questions", () => {
    const q = makeQuestion({ header: "Test" });
    const states = createInitialStates([q]);

    const lines = renderSubmitTab([q], states, theme, 80);
    expect(lines.join("")).toContain("—");
  });
});
