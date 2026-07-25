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

/**
 * Validate that the requested cwd (if any) is within the project directory.
 * Returns the resolved cwd if valid, or undefined with an error message.
 */
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

        const cwdResult = validateCwd(params.cwd, ctx.cwd);
        if ("error" in cwdResult) {
          return {
            content: [{ type: "text", text: cwdResult.error }],
            details: failedResult(agent.name, taskDesc, cwdResult.error),
          };
        }
        const resolvedCwd = cwdResult.cwd;

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

      const cwdResult = validateCwd(params.cwd, ctx.cwd);
      if ("error" in cwdResult) {
        return {
          content: [{ type: "text", text: cwdResult.error }],
          details: failedResult("parallel", "", cwdResult.error),
        };
      }
      const resolvedCwd = cwdResult.cwd;

      // Collect settled results by index so a thrown worker error
      // doesn't lose results from already-completed siblings.
      const settled = new Map<number, SubagentResult>();
      let results: SubagentResult[];
      try {
        await mapWithConcurrencyLimit(
          tasks,
          MAX_CONCURRENT,
          async ({ agent: agentName, task: taskDesc }, index, childSignal) => {
            const agent = agents.find((a) => a.name === agentName);
            if (!agent) {
              const available = agents.map((a) => a.name).join(", ") || "none";
              const r = failedResult(
                agentName,
                taskDesc,
                `Unknown agent "${agentName}". Available: ${available}`,
              );
              settled.set(index, r);
              return r;
            }

            const r = await launchSubagent(
              agent,
              taskDesc,
              resolvedCwd,
              childSignal,
              onUpdate
                ? (sr) =>
                    onUpdate({
                      content: [
                        {
                          type: "text",
                          text: `[${sr.agent}] ${sr.output || "(running...)"}`,
                        },
                      ],
                      details: sr,
                    })
                : undefined,
              config.stuckTimeoutMs,
            );
            settled.set(index, r);
            return r;
          },
          signal,
        );
        // Normal completion: all tasks processed
        results = tasks.map((_, i) => {
          const r = settled.get(i);
          if (!r) {
            throw new Error(`Internal error: task ${i} has no settled result`);
          }
          return r;
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Pre-aborted signal: no workers ever started, all tasks cancelled
          results = tasks.map((t) =>
            failedResult(t.agent, t.task, "Subagent was aborted"),
          );
        } else {
          // Worker threw an unexpected error. Preserve any results that
          // completed before the error propagated (settled siblings),
          // and fill the rest as aborted.
          results = tasks.map(
            (t, i) =>
              settled.get(i) ??
              failedResult(t.agent, t.task, "Subagent was aborted"),
          );
        }
      }

      // Fill holes from abort (unprocessed task slots are undefined)
      results = results.map(
        (r, i) =>
          r ??
          failedResult(
            tasks[i]?.agent ?? "unknown",
            tasks[i]?.task ?? "",
            "Subagent was aborted",
          ),
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
