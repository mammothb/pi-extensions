import type { AgentConfig } from "./types.js";

/**
 * Build CLI arguments for a child `pi -p` invocation from an agent config.
 * Returns an array suitable for `spawn("pi", args)`.
 */
export function buildCliArgs(agent: AgentConfig, task: string): string[] {
  const args = ["-p", "--mode", "json"];

  if (agent.noSession) {
    args.push("--no-session");
  }

  args.push("--model", agent.model);

  if (agent.thinking) {
    args.push("--thinking", agent.thinking);
  }

  if (agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  args.push(task);
  return args;
}
