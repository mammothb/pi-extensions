import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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
  pythonPath: Type.Optional(
    Type.String({
      description:
        "Path to python3 binary (e.g., '.venv/bin/python3' for venvs). " +
        "Defaults to 'python3'.",
    }),
  ),
  nodeModulesPath: Type.Optional(
    Type.String({
      description:
        "Path to a node_modules directory. When set, NODE_PATH is passed " +
        "to the subprocess so require() resolves from this directory. " +
        "Use './node_modules' for project-local packages.",
    }),
  ),
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
- Use nodeModulesPath to resolve require() from a project directory
- Use pythonPath to target a virtual environment`,
    promptSnippet:
      "Execute JavaScript or Python code in an isolated subprocess",
    parameters: Parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { language, code, pythonPath, nodeModulesPath } = params;

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
        return executePython(code, pythonPath, signal, timeoutSignal, ctx.cwd);
      }

      // ── JavaScript execution via temp file + node subprocess ──
      return executeJavaScript(
        code,
        nodeModulesPath,
        signal,
        timeoutSignal,
        ctx.cwd,
      );
    },
  };
}
