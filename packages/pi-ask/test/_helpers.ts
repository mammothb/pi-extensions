import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Option, Question } from "../src/schema.js";

/**
 * Create a mock Theme that wraps styled text in tags so rendering
 * output is predictable and testable without real ANSI escapes.
 */
export function createMockTheme(): Theme {
  const mk = {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
    bg: (color: string, text: string) => `[bg:${color}]${text}[/bg:${color}]`,
    bold: (text: string) => `[bold]${text}[/bold]`,
    italic: (text: string) => `[italic]${text}[/italic]`,
    underline: (text: string) => `[underline]${text}[/underline]`,
    inverse: (text: string) => `[inverse]${text}[/inverse]`,
    strikethrough: (text: string) => `[strikethrough]${text}[/strikethrough]`,
  };
  return mk as unknown as Theme;
}

/** A minimal, valid single-select question. */
export function makeQuestion(overrides?: Partial<Question>): Question {
  return {
    header: "Q1",
    question: "What is your preference?",
    options: [
      { label: "Option A" },
      { label: "Option B" },
      { label: "Option C" },
    ],
    multi: false,
    ...overrides,
  };
}

/** A minimal, valid multi-select question. */
export function makeMultiQuestion(overrides?: Partial<Question>): Question {
  return makeQuestion({ header: "Multi", multi: true, ...overrides });
}

/** Two single-select questions for wizard tests. */
export function makeTwoQuestions(): Question[] {
  return [
    makeQuestion({ header: "First", question: "First question?" }),
    makeQuestion({
      header: "Second",
      question: "Second question?",
      options: [{ label: "X" }, { label: "Y" }],
    }),
  ];
}

/** An option with a description. */
export function optionWithDesc(label: string, description: string): Option {
  return { label, description };
}
