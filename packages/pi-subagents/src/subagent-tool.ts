import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "./lib/agents.js";
import { mapWithConcurrencyLimit } from "./lib/concurrency.js";
import { loadSubagentConfig } from "./lib/config.js";
import { launchSubagent } from "./lib/launch.js";
import { failedResult, validateCwd } from "./lib/tool-helpers.js";
import type { SubagentResult } from "./lib/types.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENT = 4;

function summaryText(results: SubagentResult[]): string {
  const succeeded = results.filter((r) => r.exitCode === 0 && !r.error).length;
  const total = results.length;
  return `Parallel: ${succeeded}/${total} succeeded.`;
}

async function executeSingle(
  params: { agent?: string; task?: string; cwd?: string },
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<SubagentResult> | undefined,
  ctx: ExtensionContext,
  agents: ReturnType<typeof discoverAgents>,
  stuckTimeoutMs: number,
  parentSessionFile: string | undefined,
): Promise<AgentToolResult<SubagentResult>> {
  const agentName = params.agent ?? "";
  const taskDesc = params.task ?? "";

  if (!agentName) {
    return {
      content: [{ type: "text", text: "agent is required in single mode" }],
      details: failedResult("", taskDesc, "agent is required"),
    };
  }
  if (!taskDesc) {
    return {
      content: [{ type: "text", text: "task is required in single mode" }],
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

  const result = await launchSubagent(
    agent,
    taskDesc,
    cwdResult.cwd,
    signal,
    onUpdate
      ? (r) =>
          onUpdate({
            content: [{ type: "text", text: r.output || "(running...)" }],
            details: r,
          })
      : undefined,
    stuckTimeoutMs,
    parentSessionFile,
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

async function executeParallel(
  params: { tasks?: Array<{ agent: string; task: string }>; cwd?: string },
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<SubagentResult> | undefined,
  ctx: ExtensionContext,
  agents: ReturnType<typeof discoverAgents>,
  stuckTimeoutMs: number,
  parentSessionFile: string | undefined,
): Promise<AgentToolResult<SubagentResult>> {
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
          stuckTimeoutMs,
          parentSessionFile,
        );
        settled.set(index, r);
        return r;
      },
      signal,
    );
    results = tasks.map((_, i) => {
      const r = settled.get(i);
      if (!r) {
        throw new Error(`Internal error: task ${i} has no settled result`);
      }
      return r;
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      results = tasks.map((t) =>
        failedResult(t.agent, t.task, "Subagent was aborted"),
      );
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      results = tasks.map(
        (t, i) => settled.get(i) ?? failedResult(t.agent, t.task, errorMessage),
      );
    }
  }

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
        cacheWrite: results.reduce((sum, r) => sum + r.tokens.cacheWrite, 0),
        total: results.reduce((sum, r) => sum + r.tokens.total, 0),
        turns: results.reduce((sum, r) => sum + r.tokens.turns, 0),
      },
      results,
    },
  };
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
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<SubagentResult>> {
      const agents = discoverAgents(ctx.cwd);
      const config = loadSubagentConfig();
      const parentSessionFile =
        ctx.sessionManager?.getSessionFile() ?? undefined;

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

      if (hasSingle) {
        return executeSingle(
          params,
          signal,
          onUpdate,
          ctx,
          agents,
          config.stuckTimeoutMs,
          parentSessionFile,
        );
      }

      return executeParallel(
        params,
        signal,
        onUpdate,
        ctx,
        agents,
        config.stuckTimeoutMs,
        parentSessionFile,
      );
    },
  };
}
