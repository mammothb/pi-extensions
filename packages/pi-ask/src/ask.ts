import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Box } from "@earendil-works/pi-tui";
import { BgSafeTruncatedText } from "@mammothb/pi-shared";
import { AskComponent } from "./lib/component.js";
import { createAskKeybindings } from "./lib/keybindings.js";
import { validateUniqueQuestions } from "./lib/validate.js";
import type { QuestionT, ResultT } from "./schema.js";
import { AskParams as AskParamsSchema } from "./schema.js";

function formatAnswersAsText(result: ResultT): string {
  return result.questions
    .map((q) => {
      const answer = result.answers[q.question];
      return answer !== undefined
        ? `"${q.question}" = "${answer}"`
        : `"${q.question}" = (no answer)`;
    })
    .join("\n");
}

export function createAskTool(): ToolDefinition<
  typeof AskParamsSchema,
  ResultT
> {
  return {
    name: "ask",
    label: "Ask",
    description: `Ask the user 1-4 questions before proceeding.
Use this tool when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take
    `,
    promptSnippet: "Ask the user 1-4 questions before proceeding",
    promptGuidelines: [
      "Use ask when you need user input on preferences, requirements, implementation decisions.",
      'Each question must have 2-4 options. Users can always select "Other" to type a free-text answer, so do not include an "Other" option yourself.',
      "Option labels should be concise (1-5 words).",
      "Set multi: true when more than one option can validly apply at the same time.",
      "The header field is a short label (max 12 characters) used in the tab bar when showing multiple questions.",
      'Set recommended: <index> to mark a default option with "(Recommended)" (0-based index).',
      "Always use this tool instead of asking questions in plain text — it provides a structured, interactive UI.",
    ],
    parameters: AskParamsSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.questions.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No questions provided" }],
          details: {
            questions: [],
            answers: {},
            cancelled: true,
          },
        };
      }

      if (!ctx.hasUI) {
        ctx.abort();
        throw new Error("Ask tool requires interactive mode");
      }
      const validationError = validateUniqueQuestions(params.questions);
      if (validationError) {
        return {
          content: [{ type: "text", text: `Error: ${validationError}` }],
          details: {
            questions: params.questions,
            answers: {},
            cancelled: true,
          },
        };
      }

      const result = await ctx.ui.custom<ResultT | null>(
        (tui, theme, kb, done) =>
          new AskComponent(
            params.questions,
            tui,
            theme,
            done,
            createAskKeybindings(kb.getUserBindings()),
          ),
      );
      if (result === null || result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled" }],
          details: {
            questions: params.questions,
            answers: {},
            cancelled: true,
          },
        };
      }

      return {
        content: [{ type: "text", text: formatAnswersAsText(result) }],
        details: result,
      };
    },

    renderCall(args, theme) {
      const questions = (args.questions ?? []) as QuestionT[];
      const topics = questions.map((q) => q.header).join(", ");
      return new BgSafeTruncatedText(
        theme.fg("toolTitle", theme.bold("ask user ")) +
          theme.fg("muted", topics),
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as ResultT | undefined;

      if (!details) {
        const t = result.content[0];
        return new BgSafeTruncatedText(t?.type === "text" ? t.text : "", 0, 0);
      }

      if (details.cancelled) {
        return new BgSafeTruncatedText(theme.fg("warning", "Cancelled"), 0, 0);
      }

      // One TruncatedText per question — each truncated independently.
      // BgSafeTruncatedText preserves background color across the ellipsis.
      const box = new Box(0, 0);
      for (const q of details.questions) {
        const answer = details.answers[q.question] ?? "(no answer)";
        box.addChild(
          new BgSafeTruncatedText(
            theme.fg("success", "✓ ") +
              theme.fg("accent", `${q.header}: `) +
              theme.fg("text", answer),
            0,
            0,
          ),
        );
      }
      return box;
    },
  };
}
