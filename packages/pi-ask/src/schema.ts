import { type Static, Type } from "typebox";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display label for this option" }),
  description: Type.Optional(
    Type.String({
      description: "Optional descriptive text explaining this option",
    }),
  ),
});

const QuestionSchema = Type.Object({
  header: Type.String({
    description:
      "Short label used in the tab bar when multiple questions are shown. (Max 12 characters)",
  }),
  question: Type.String({ description: "The question text to display" }),
  options: Type.Array(OptionSchema, {
    minItems: 2,
    maxItems: 4,
    description: "Available answer options (2 to 4)",
  }),
  multi: Type.Boolean({ description: "Allow selecting multiple options" }),
  recommended: Type.Optional(
    Type.Number({
      description: "Index of the recommended/default option",
    }),
  ),
});

export const AskParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: 4,
    description: "Questions to ask (1 to 4)",
  }),
});

export type Option = Static<typeof OptionSchema>;
export type Question = Static<typeof QuestionSchema>;

const ResultSchema = Type.Object({
  // Pass-through so renderResult has headers + option descriptions without
  // re-parsing the LLM input.
  questions: Type.Array(QuestionSchema),
  // Maps question text → selected label(s).
  // Multi-select: labels joined with ", " e.g. "Option A, Option C"
  // Free-text: the user's typed string verbatim
  // Cancelled: key absent (see cancelled flag)
  answers: Type.Record(Type.String(), Type.String()),
  // True when the user pressed Esc before submitting
  cancelled: Type.Boolean(),
});

export type AskResult = Static<typeof ResultSchema>;
