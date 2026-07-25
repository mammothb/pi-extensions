import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildCliArgs, launchPiChild } from "./lib/launch.js";
import { readLaunchMetadata } from "./lib/session.js";
import type { AgentConfig, SubagentResult } from "./lib/types.js";

function failedResult(
  agent: string,
  task: string,
  output: string,
): SubagentResult {
  return {
    agent,
    task,
    output,
    exitCode: 1,
    elapsed: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      turns: 0,
    },
    error: output,
  };
}

function validateCwd(
  cwdParam: string | undefined,
  ctxCwd: string,
): { cwd: string } | { error: string } {
  const resolvedCwd = cwdParam ? resolve(cwdParam) : ctxCwd;
  if (!cwdParam) {
    return { cwd: resolvedCwd };
  }
  const resolvedCtxCwd = resolve(ctxCwd);
  if (
    resolvedCwd !== resolvedCtxCwd &&
    !resolvedCwd.startsWith(resolvedCtxCwd + sep)
  ) {
    return {
      error: `cwd "${cwdParam}" is outside the project directory "${ctxCwd}"`,
    };
  }
  return { cwd: resolvedCwd };
}

export function createResumeTool(stuckTimeoutMs: number) {
  return {
    name: "subagent_resume",
    label: "Subagent Resume",
    description:
      "Resume a previously-launched subagent from its persistent session file. " +
      "Restores the original agent's model, tools, and thinking configuration. " +
      "Use after killing a stuck child or for follow-up work on the same context.",
    parameters: Type.Object({
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
    }),

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
      const sessionFile = params.session;

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
                `Cannot resume: session was created before launch metadata persistence was added. ` +
                `This session file was produced by an older version of pi-subagents. ` +
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

      const cwdResult = validateCwd(params.cwd, ctx.cwd);
      if ("error" in cwdResult) {
        return {
          content: [{ type: "text", text: cwdResult.error }],
          details: failedResult("resume", params.task, cwdResult.error),
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
        stuckTimeoutMs,
      );

      // Result always has the existing session file
      result.sessionFile = sessionFile;

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
  };
}
