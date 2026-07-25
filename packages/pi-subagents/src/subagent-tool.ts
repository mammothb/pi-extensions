import { resolve, sep } from "node:path";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "./lib/agents.js";
import { mapWithConcurrencyLimit } from "./lib/concurrency.js";
import { loadSubagentConfig } from "./lib/config.js";
import { launchSubagent } from "./lib/launch.js";
import type { SubagentResult } from "./lib/types.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENT = 4;

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

function summaryText(results: SubagentResult[]): string {
  const succeeded = results.filter((r) => r.exitCode === 0 && !r.error).length;
  const total = results.length;
  return `Parallel: ${succeeded}/${total} succeeded.`;
}

export function createSubagentTool() {
  return {
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a task to a specialized subagent with isolated context.",
    parameters: Type.Object({
      agent: Type.Optional(
        Type.String({
          description: "Name of the agent to invoke (single mode)",
        }),
      ),
      task: Type.Optional(
        Type.String({ description: "Task to delegate (single mode)" }),
      ),
      tasks: Type.Optional(
        Type.Array(
          Type.Object({
            agent: Type.String({ description: "Agent name" }),
            task: Type.String({ description: "Task description" }),
          }),
          { maxItems: MAX_PARALLEL_TASKS },
        ),
      ),
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the agent process" }),
      ),
    }),

    async execute(
      _toolCallId: string,
      params: {
        agent?: string;
        task?: string;
        tasks?: Array<{ agent: string; task: string }>;
        cwd?: string;
      },
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<SubagentResult> | undefined,
      ctx: { cwd: string },
    ): Promise<AgentToolResult<SubagentResult>> {
      const agents = discoverAgents(ctx.cwd);
      const config = loadSubagentConfig();

      // --- Mode detection: exactly one of {agent+task} or {tasks} must be provided ---
      const hasSingle = params.agent !== undefined || params.task !== undefined;
      const hasParallel = params.tasks !== undefined;

      if (hasSingle && hasParallel) {
        return {
          content: [
            {
              type: "text",
              text: "Provide either (agent + task) for single mode, or (tasks) for parallel mode, not both.",
            },
          ],
          details: failedResult(
            "subagent",
            "",
            "Provide either (agent + task) for single mode, or (tasks) for parallel mode, not both.",
          ),
        };
      }

      if (!hasSingle && !hasParallel) {
        return {
          content: [
            {
              type: "text",
              text: "Provide either (agent + task) for single mode, or (tasks) for parallel mode.",
            },
          ],
          details: failedResult(
            "subagent",
            "",
            "Provide either (agent + task) for single mode, or (tasks) for parallel mode.",
          ),
        };
      }

      // --- Single mode ---
      if (hasSingle) {
        const agentName = params.agent ?? "";
        const taskDesc = params.task ?? "";

        if (!agentName) {
          return {
            content: [
              { type: "text", text: "agent is required in single mode" },
            ],
            details: failedResult("", taskDesc, "agent is required"),
          };
        }
        if (!taskDesc) {
          return {
            content: [
              { type: "text", text: "task is required in single mode" },
            ],
            details: failedResult(agentName, "", "task is required"),
          };
        }

        const agent = agents.find((a) => a.name === agentName);
        if (!agent) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          return {
            content: [
              {
                type: "text",
                text: `Unknown agent "${agentName}". Available: ${available}`,
              },
            ],
            details: failedResult(
              agentName,
              taskDesc,
              `Unknown agent "${agentName}". Available: ${available}`,
            ),
          };
        }

        const resolvedCwd = params.cwd ? resolve(params.cwd) : ctx.cwd;
        const resolvedCtxCwd = resolve(ctx.cwd);
        if (
          params.cwd &&
          !(
            resolvedCwd === resolvedCtxCwd ||
            resolvedCwd.startsWith(resolvedCtxCwd + sep)
          )
        ) {
          return {
            content: [
              {
                type: "text",
                text: `cwd "${params.cwd}" is outside the project directory "${ctx.cwd}"`,
              },
            ],
            details: failedResult(
              agent.name,
              taskDesc,
              `cwd "${params.cwd}" is outside the project directory "${ctx.cwd}"`,
            ),
          };
        }

        const result = await launchSubagent(
          agent,
          taskDesc,
          resolvedCwd,
          signal,
          onUpdate
            ? (r) =>
                onUpdate({
                  content: [{ type: "text", text: r.output || "(running...)" }],
                  details: r,
                })
            : undefined,
          config.stuckTimeoutMs,
        );

        if (result.exitCode !== 0) {
          return {
            content: [
              {
                type: "text",
                text: `Agent "${result.agent}" failed (exit ${result.exitCode}): ${result.error || result.output}`,
              },
            ],
            details: result,
          };
        }

        return {
          content: [{ type: "text", text: result.output || "(no output)" }],
          details: result,
        };
      }

      // --- Parallel mode ---
      const tasks = params.tasks;
      if (!tasks || tasks.length === 0) {
        return {
          content: [{ type: "text", text: "tasks array must not be empty" }],
          details: failedResult("parallel", "", "tasks array is empty"),
        };
      }

      const resolvedCwd = params.cwd ? resolve(params.cwd) : ctx.cwd;
      const resolvedCtxCwd = resolve(ctx.cwd);
      if (
        params.cwd &&
        !(
          resolvedCwd === resolvedCtxCwd ||
          resolvedCwd.startsWith(resolvedCtxCwd + sep)
        )
      ) {
        return {
          content: [
            {
              type: "text",
              text: `cwd "${params.cwd}" is outside the project directory "${ctx.cwd}"`,
            },
          ],
          details: failedResult(
            "parallel",
            "",
            `cwd "${params.cwd}" is outside the project directory "${ctx.cwd}"`,
          ),
        };
      }

      let results: SubagentResult[];
      try {
        results = await mapWithConcurrencyLimit(
          tasks,
          MAX_CONCURRENT,
          async ({ agent: agentName, task: taskDesc }, _index, childSignal) => {
            const agent = agents.find((a) => a.name === agentName);
            if (!agent) {
              const available = agents.map((a) => a.name).join(", ") || "none";
              return failedResult(
                agentName,
                taskDesc,
                `Unknown agent "${agentName}". Available: ${available}`,
              );
            }

            return launchSubagent(
              agent,
              taskDesc,
              resolvedCwd,
              childSignal,
              onUpdate
                ? (r) =>
                    onUpdate({
                      content: [
                        {
                          type: "text",
                          text: `[${r.agent}] ${r.output || "(running...)"}`,
                        },
                      ],
                      details: r,
                    })
                : undefined,
              config.stuckTimeoutMs,
            );
          },
          signal,
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Pre-aborted signal: all tasks cancelled before launch
          results = tasks.map((t) =>
            failedResult(t.agent, t.task, "Subagent was aborted"),
          );
        } else {
          throw err;
        }
      }

      // Fill holes from abort (unprocessed task slots are undefined)
      results = tasks.map(
        (t, i) =>
          results[i] ?? failedResult(t.agent, t.task, "Subagent was aborted"),
      );

      const summary = summaryText(results);
      return {
        content: [{ type: "text", text: summary }],
        details: {
          agent: "parallel",
          task: `${tasks.length} tasks`,
          output: summary,
          exitCode: results.every((r) => r.exitCode === 0) ? 0 : 1,
          elapsed: results.reduce((sum, r) => sum + r.elapsed, 0),
          tokens: {
            input: results.reduce((sum, r) => sum + r.tokens.input, 0),
            output: results.reduce((sum, r) => sum + r.tokens.output, 0),
            cacheRead: results.reduce((sum, r) => sum + r.tokens.cacheRead, 0),
            cacheWrite: results.reduce(
              (sum, r) => sum + r.tokens.cacheWrite,
              0,
            ),
            total: results.reduce((sum, r) => sum + r.tokens.total, 0),
            turns: results.reduce((sum, r) => sum + r.tokens.turns, 0),
          },
          results,
        },
      };
    },
  };
}
