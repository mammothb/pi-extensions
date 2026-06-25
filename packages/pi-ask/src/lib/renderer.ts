import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Question } from "../schema.js";
import type { EditorAdapter } from "./editor-adapter.js";
import {
  allConfirmed,
  getAnswerText,
  getOptions,
  type QuestionState,
} from "./state.js";

/** Truncate plain text with ellipsis, preserving character boundaries. */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text;
  }
  const ELLIPSIS = "...";
  const keep = maxWidth - ELLIPSIS.length;
  return keep > 0 ? text.slice(0, keep) + ELLIPSIS : text.slice(0, maxWidth);
}

// ── Top-level render ─────────────────────────────────────────────────────────

/**
 * Render the full ask component for the given width.
 * Pure function — same inputs always produce the same string[].
 */
export function renderAskComponent(
  questions: Question[],
  states: QuestionState[],
  activeTab: number,
  isSingle: boolean,
  theme: Theme,
  width: number,
  editor?: EditorAdapter,
): string[] {
  if (questions.length === 0) {
    return [];
  }

  const lines: string[] = [];
  const add = (s: string) => lines.push(truncateToWidth(s, width));

  // Top separator
  add(theme.fg("accent", "─".repeat(width)));

  // Tab bar (multi-question only)
  if (!isSingle) {
    for (const line of renderTabBar(
      questions,
      states,
      activeTab,
      theme,
      width,
    )) {
      add(line);
    }
    lines.push("");
  }

  // Question body or Submit tab
  const q = questions[activeTab];
  const state = states[activeTab];
  if (!q || !state) {
    for (const line of renderSubmitTab(questions, states, theme, width)) {
      add(line);
    }
  } else {
    for (const line of renderQuestionBody(
      q,
      state,
      isSingle,
      theme,
      width,
      editor,
    )) {
      add(line);
    }
  }

  // Bottom separator
  add(theme.fg("accent", "─".repeat(width)));

  return lines;
}

// ── Tab bar ──────────────────────────────────────────────────────────────────

export function renderTabBar(
  questions: Question[],
  states: QuestionState[],
  activeTab: number,
  theme: Theme,
  _width: number,
): string[] {
  const parts: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const s = states[i];
    if (!q || !s) {
      continue;
    }
    const isActive = i === activeTab;
    const header = truncateText(q.header, 12);
    const label = ` ${header} `;

    let styled: string;
    if (isActive) {
      styled = theme.bg("selectedBg", theme.fg("text", label));
    } else if (s.confirmed) {
      styled = theme.fg("success", label);
    } else {
      styled = theme.fg("muted", label);
    }
    parts.push(styled);
  }

  // Submit tab
  const isSubmitActive = activeTab === questions.length;
  const submitLabel = " Submit ";
  let submitStyled: string;
  if (isSubmitActive) {
    submitStyled = theme.bg("selectedBg", theme.fg("text", submitLabel));
  } else if (allConfirmed(states)) {
    submitStyled = theme.fg("success", submitLabel);
  } else {
    submitStyled = theme.fg("dim", submitLabel);
  }
  parts.push(submitStyled);

  return [parts.join("")];
}

// ── Question body ────────────────────────────────────────────────────────────

export function renderQuestionBody(
  q: Question,
  state: QuestionState,
  isSingle: boolean,
  theme: Theme,
  width: number,
  editor?: EditorAdapter,
): string[] {
  const lines: string[] = [];
  const add = (s: string) => lines.push(s);
  const opts = getOptions(q);

  // Question text (word-wrapped)
  const wrapped = wrapTextWithAnsi(theme.fg("text", q.question), width - 2);
  for (const line of wrapped) {
    add(line);
  }
  add("");

  // Options list
  for (let i = 0; i < opts.length; i++) {
    const opt = opts[i];
    if (!opt) {
      continue;
    }
    const isHighlighted = i === state.cursorIndex;
    const isOther = opt.isOther === true;
    const prefix = isHighlighted ? theme.fg("accent", ">") : " ";

    const isRecommended = q.recommended === i;
    const recommendedSuffix = isRecommended
      ? theme.fg("dim", " (Recommended)")
      : "";

    if (q.multi && !isOther) {
      // Checkbox style
      const checked = state.selectedIndices.has(i);
      const box = checked ? theme.fg("accent", "[x]") : theme.fg("dim", "[ ]");
      const labelColor = isHighlighted ? "accent" : "text";
      add(
        `${prefix} ${box} ${theme.fg(labelColor, `${i + 1}. ${opt.label}`)}${recommendedSuffix}`,
      );
    } else if (isOther) {
      const hasFreeText = state.freeTextValue !== null && !state.inEditMode;
      const suffix = state.inEditMode ? theme.fg("accent", " ✎") : "";
      const labelColor = isHighlighted ? "accent" : "muted";
      if (q.multi) {
        const box = hasFreeText
          ? theme.fg("success", "[x]")
          : theme.fg("dim", "[ ]");
        add(
          `${prefix} ${box} ${theme.fg(labelColor, `${i + 1}. ${opt.label}`)}${suffix}`,
        );
      } else {
        const check = hasFreeText ? theme.fg("success", "✓") : " ";
        add(
          `${prefix} ${check} ${theme.fg(labelColor, `${i + 1}. ${opt.label}`)}${suffix}`,
        );
      }
      // Preview of saved text below
      if (hasFreeText) {
        const indent = " ".repeat(q.multi ? 9 : 7);
        const preview = truncateText(
          state.freeTextValue ?? "",
          width - indent.length,
        );
        add(`${indent}${theme.fg("dim", `"${preview}"`)}`);
      }
    } else {
      // Single-select — show ✓ on the confirmed selection
      const isConfirmedChoice = state.selectedIndex === i;
      const check = isConfirmedChoice ? theme.fg("success", "✓") : " ";
      const labelColor = isHighlighted ? "accent" : "text";
      add(
        `${prefix} ${check} ${theme.fg(labelColor, `${i + 1}. ${opt.label}`)}${recommendedSuffix}`,
      );
    }

    // Description (if present, not for "Type your own answer...")
    if (!isOther && opt.description) {
      const indent = " ".repeat(q.multi ? 9 : 7);
      const descWrapped = wrapTextWithAnsi(
        theme.fg("muted", opt.description),
        width - indent.length,
      );
      for (const line of descWrapped) {
        add(`${indent}${line}`);
      }
    }
  }

  // Inline editor (when in edit mode)
  if (state.inEditMode && editor) {
    add("");
    add(theme.fg("muted", " Your answer:"));
    const editorLines = editor.render(width - 4);
    for (const line of editorLines) {
      add(` ${line}`);
    }
  }

  add("");

  // Footer help — context-sensitive based on cursor position
  if (state.inEditMode) {
    add(theme.fg("dim", " Enter submit · Esc back"));
  } else {
    const isOnOther = state.cursorIndex === opts.length - 1;
    const tabHint = isSingle ? "" : " · ←→/hl switch tabs";
    let actionHint: string;
    if (isOnOther) {
      actionHint = "Space/Tab open editor";
    } else if (q.multi) {
      actionHint = "Space toggle · Enter confirm";
    } else {
      actionHint = "Space/Enter select";
    }
    add(
      theme.fg("dim", ` ↑↓/kj navigate · ${actionHint}${tabHint} · Esc cancel`),
    );
  }

  return lines;
}

// ── Submit tab ───────────────────────────────────────────────────────────────

export function renderSubmitTab(
  questions: Question[],
  states: QuestionState[],
  theme: Theme,
  _width: number,
): string[] {
  const lines: string[] = [];
  const add = (s: string) => lines.push(s);
  const allDone = allConfirmed(states);

  const title = allDone
    ? theme.fg("success", theme.bold(" Ready to submit"))
    : theme.fg("warning", theme.bold(" Unanswered questions"));
  add(title);
  add("");

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const state = states[i];
    if (!q || !state) {
      continue;
    }
    const answer = getAnswerText(q, state);
    if (answer !== null) {
      add(
        theme.fg("muted", ` ${truncateText(q.header, 12)}: `) +
          theme.fg("text", answer),
      );
    } else {
      add(
        theme.fg("dim", ` ${truncateText(q.header, 12)}: `) +
          theme.fg("warning", "—"),
      );
    }
  }

  add("");
  if (allDone) {
    add(theme.fg("success", " Press Enter to submit"));
  } else {
    const missing = questions
      .filter((_, i) => !states[i]?.confirmed)
      .map((q) => truncateText(q.header, 12))
      .join(", ");
    add(theme.fg("warning", ` Still needed: ${missing}`));
  }
  add("");
  add(theme.fg("dim", " ←→/hl switch tabs · Esc cancel"));

  return lines;
}
