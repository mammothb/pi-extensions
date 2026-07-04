import type {
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Box } from "@earendil-works/pi-tui";
import type { AskPromptPayload } from "@mammothb/pi-shared";
import { BgSafeTruncatedText } from "@mammothb/pi-shared";
import { AskComponent } from "./lib/component.js";
import { createAskKeybindings } from "./lib/keybindings.js";
import { validateUniqueQuestions } from "./lib/validate.js";
import type { AskResult, Question } from "./schema.js";
import { AskParamsSchema } from "./schema.js";

function formatAnswersAsText(result: AskResult): string {
  return result.questions
    .map((q) => {
      const answer = result.answers[q.question];
      return answer !== undefined
        ? `"${q.question}" = "${answer}"`
        : `"${q.question}" = (no answer)`;
    })
    .join("\n");
}

export function createAskTool(
  pi: ExtensionAPI,
): ToolDefinition<typeof AskParamsSchema, AskResult> {
  return {
    name: "AskUserQuestion",
    label: "Ask",
    description:
      "Ask the user questions with a structured interactive TUI form. " +
      "Each question has 2-4 options. Supports multi-select, recommended defaults, " +
      "and an always-available free-text 'Other' answer. Use for gathering preferences, " +
      "clarifying ambiguity, or offering implementation choices.",
    promptSnippet: "Ask the user questions with a structured interactive UI",
    promptGuidelines: [
      "Use AskUserQuestion instead of asking questions in plain text — it provides a structured, interactive UI. Prefer it whenever a question can be answered with 2-4 concrete options.",
      "If a skill or instruction says 'interview', 'ask the user', 'grill', 'gather requirements', 'clarify', or 'what should I use', call AskUserQuestion — do not output questions as plain text.",
      'AskUserQuestion: each question must have 2-4 options. An "Other" free-text answer is always available, so do not include an explicit "Other" option yourself.',
      "AskUserQuestion: option labels should be concise (1-5 words).",
      "AskUserQuestion: set multi: true when more than one option can validly apply at the same time.",
      "AskUserQuestion: the header field is a short label (max 12 characters) displayed in the tab bar.",
      'AskUserQuestion: set recommended: <index> to mark a default option with "(Recommended)" (0-based index).',
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

      const payload: AskPromptPayload = { questions: params.questions };
      pi.events.emit("AskUserQuestion:prompt", payload);

      const result = await ctx.ui.custom<AskResult | null>(
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
      const questions = (args.questions ?? []) as Question[];
      const topics = questions.map((q) => q.header).join(", ");
      return new BgSafeTruncatedText(
        theme.fg("toolTitle", theme.bold("ask user ")) +
          theme.fg("muted", topics),
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskResult | undefined;

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
