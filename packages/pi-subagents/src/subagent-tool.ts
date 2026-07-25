import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { discoverAgents } from "./lib/agents.js";
import { loadSubagentConfig } from "./lib/config.js";
import { launchSubagent } from "./lib/launch.js";
import type { SubagentResult } from "./lib/types.js";

export function createSubagentTool() {
  return {
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate a task to a specialized subagent with isolated context.",
    parameters: Type.Object({
      agent: Type.String({ description: "Name of the agent to invoke" }),
      task: Type.String({ description: "Task to delegate to the agent" }),
      cwd: Type.Optional(
        Type.String({ description: "Working directory for the agent process" }),
      ),
    }),

    async execute(
      _toolCallId: string,
      params: { agent: string; task: string; cwd?: string },
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<SubagentResult> | undefined,
      ctx: { cwd: string },
    ): Promise<AgentToolResult<SubagentResult>> {
      const agents = discoverAgents(ctx.cwd);
      const config = loadSubagentConfig();

      const agent = agents.find((a) => a.name === params.agent);
      if (!agent) {
        const available = agents.map((a) => a.name).join(", ") || "none";
        return {
          content: [
            {
              type: "text",
              text: `Unknown agent "${params.agent}". Available: ${available}`,
            },
          ],
          details: undefined as unknown as SubagentResult,
        };
      }

      const result = await launchSubagent(
        agent,
        params.task,
        params.cwd ?? ctx.cwd,
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
    },
  };
}
