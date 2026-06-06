import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig } from "./config.js";
import { executeJavaScript } from "./javascript.js";
import { executePython } from "./python.js";
import {
  EvalCancelledError,
  type EvalDetails,
  EvalUnsupportedLanguageError,
} from "./types.js";

export const TIMEOUT_MS = 30_000;

const Parameters = Type.Object({
  language: Type.Union([Type.Literal("javascript"), Type.Literal("python")]),
  code: Type.String({ description: "Code to execute" }),
});

export function createEvalTool(): ToolDefinition<
  typeof Parameters,
  EvalDetails
> {
  return {
    name: "eval",
    label: "Eval",
    description: `Execute JavaScript or Python code in an isolated subprocess.

- Each call is a fresh subprocess — no state persists between calls
- 30-second timeout; press Escape to cancel a running evaluation
- Working directory is the agent's current working directory (like bash)
- Set pythonPath or nodeModulesPath in ~/.pi/agent/pi-eval.json (global) or .pi/pi-eval.json (project) to configure the runtime for all eval calls`,
    promptSnippet:
      "Execute JavaScript or Python code in an isolated subprocess",
    parameters: Parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { language, code } = params;
      const config = loadConfig(ctx.cwd);

      // Validate language (belt-and-suspenders: TypeBox schema already constrains it,
      // but a raw API call could bypass validation)
      if (language !== "javascript" && language !== "python") {
        throw new EvalUnsupportedLanguageError(language);
      }

      if (signal?.aborted) {
        throw new EvalCancelledError();
      }

      // Build timeout signal — passed separately from the user signal so
      // subprocess.ts can discriminate timeout vs user cancel
      const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);

      if (timeoutSignal.aborted) {
        throw new EvalCancelledError();
      }

      if (language === "python") {
        return executePython(
          code,
          config.pythonPath,
          signal,
          timeoutSignal,
          ctx.cwd,
        );
      }

      // ── JavaScript execution via temp file + node subprocess ──
      return executeJavaScript(
        code,
        config.nodeModulesPath,
        signal,
        timeoutSignal,
        ctx.cwd,
      );
    },
  };
}
