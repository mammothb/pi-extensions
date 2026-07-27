import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { loadSubagentConfig } from "./lib/config.js";
import { buildCliArgs, launchPiChild } from "./lib/launch.js";
import {
  renderSubagentToolResult,
  stripMessagesForPersistence,
} from "./lib/rendering.js";
import { generateChildSessionFile, readLaunchMetadata } from "./lib/session.js";
import { failedResult, validateCwd } from "./lib/tool-helpers.js";
import type { AgentConfig, SubagentResult } from "./lib/types.js";

/**
 * Validate that params.session is within an approved session directory.
 * Accepts paths under the default pi-subagents session root or ctx.cwd.
 */
function validateSession(
  sessionParam: string,
  ctxCwd: string,
): { session: string } | { error: string } {
  const resolved = resolve(sessionParam);
  const resolvedCtx = resolve(ctxCwd);
  const defaultRoot = resolve(generateChildSessionFile(), "..");

  const withinCtx =
    resolved === resolvedCtx || resolved.startsWith(resolvedCtx + sep);
  const withinDefault =
    resolved === defaultRoot || resolved.startsWith(defaultRoot + sep);

  if (!withinCtx && !withinDefault) {
    return {
      error: `Session path "${sessionParam}" is outside approved directories`,
    };
  }
  return { session: resolved };
}

const ResumeParamsSchema = Type.Object({
  session: Type.String({
    description:
      "Path to the child's session file (from SubagentResult.sessionFile)",
  }),
  task: Type.String({
    description: "Follow-up instruction for the resumed agent",
  }),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the agent process",
    }),
  ),
});

export function createResumeTool(): ToolDefinition<
  typeof ResumeParamsSchema,
  SubagentResult
> {
  return {
    name: "subagent_resume",
    label: "Subagent Resume",
    description:
      "Resume a previously-launched subagent from its persistent session file. " +
      "Restores the original agent's model, tools, and thinking configuration. " +
      "Use after killing a stuck child or for follow-up work on the same context.",
    parameters: ResumeParamsSchema,

    async execute(
      _toolCallId: string,
      params: {
        session: string;
        task: string;
        cwd?: string;
      },
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<SubagentResult> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<SubagentResult>> {
      // Validate cwd before file I/O
      const cwdResult = validateCwd(params.cwd, ctx.cwd);
      if ("error" in cwdResult) {
        return {
          content: [{ type: "text", text: cwdResult.error }],
          details: failedResult("resume", params.task, cwdResult.error),
        };
      }

      // Validate session path is within approved directories
      const sessionResult = validateSession(params.session, ctx.cwd);
      if ("error" in sessionResult) {
        return {
          content: [{ type: "text", text: sessionResult.error }],
          details: failedResult("resume", params.task, sessionResult.error),
        };
      }
      const sessionFile = sessionResult.session;

      if (!existsSync(sessionFile)) {
        return {
          content: [
            {
              type: "text",
              text: `Session file not found: ${sessionFile}`,
            },
          ],
          details: failedResult(
            "resume",
            params.task,
            `Session file not found: ${sessionFile}`,
          ),
        };
      }

      // Read launch metadata to restore original agent config
      const metadata = readLaunchMetadata(sessionFile);
      if (!metadata) {
        return {
          content: [
            {
              type: "text",
              text:
                `Cannot resume: session has no valid launch metadata (missing or unreadable). ` +
                `This may be a corrupt session file or one created by an older version of pi-subagents. ` +
                `Create a new subagent with the same task instead.`,
            },
          ],
          details: failedResult(
            "resume",
            params.task,
            "Session file has no launch metadata — cannot restore agent config",
          ),
        };
      }

      // Reconstruct AgentConfig from persisted metadata
      const agent: AgentConfig = {
        name: metadata.name,
        description: "",
        model: metadata.model,
        thinking: metadata.thinking,
        tools: metadata.tools,
        mode: metadata.mode,
        sandbox: metadata.sandbox,
        noSession: metadata.noSession,
        body: "",
      };

      const config = loadSubagentConfig(ctx.cwd);
      const args = buildCliArgs(agent, params.task, sessionFile);

      const result = await launchPiChild(
        args,
        agent,
        params.task,
        cwdResult.cwd,
        signal,
        onUpdate
          ? (r) =>
              onUpdate({
                content: [
                  {
                    type: "text",
                    text: r.output || "(running...)",
                  },
                ],
                details: r,
              })
          : undefined,
        config.stuckTimeoutMs,
      );

      // Result always has the existing session file
      result.sessionFile = sessionFile;
      result.messages = stripMessagesForPersistence(result.messages);

      if (result.exitCode !== 0) {
        return {
          content: [
            {
              type: "text",
              text: `Resumed agent "${result.agent}" failed (exit ${result.exitCode}): ${result.error || result.output}`,
            },
          ],
          details: result,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: result.output || "(no output)",
          },
        ],
        details: result,
      };
    },

    // ── TUI Rendering ──────────────────────────────────────────────────

    renderCall(args, theme, _context) {
      const argsRecord = args as Static<typeof ResumeParamsSchema>;
      const sessionBasename =
        argsRecord.session?.split("/").pop()?.split("\\").pop() ??
        argsRecord.session ??
        "?";
      return new Text(
        theme.fg("toolTitle", theme.bold("resume")) +
          theme.fg("muted", " · ") +
          theme.fg("text", sessionBasename),
        0,
        0,
      );
    },

    renderResult(result, options, theme, context) {
      return renderSubagentToolResult(result, options, theme, context);
    },
  };
}
