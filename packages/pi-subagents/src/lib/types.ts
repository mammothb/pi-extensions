import type { Message } from "@earendil-works/pi-ai";

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  thinking: string;
  tools: string[];
  mode: "clean" | "fork";
  sandbox: boolean;
  noSession: boolean;
  body: string;
}

export interface SubagentParams {
  agent?: string;
  task?: string;
  tasks?: Array<{ agent: string; task: string }>;
  mode?: "clean" | "fork";
  cwd?: string;
}

export interface SubagentResult {
  agent: string;
  task: string;
  output: string;
  exitCode: number;
  elapsed: number;
  sessionFile?: string;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    turns: number;
  };
  model?: string;
  error?: string;
  /** Raw child process messages (agent + tool results). Used by TUI for tool call rendering. */
  messages?: Message[];
  /** Individual results when executing in parallel mode. Omitted for single mode. */
  results?: SubagentResult[];
}

export interface SubagentConfig {
  tiers: Record<string, string>;
  stuckTimeoutMs: number;
}

/**
 * Signature of the child-launch callback used by {@link launchSubagent}.
 * Tests inject a stub here to verify fork-seeding + cleanup logic without
 * spawning a real pi process.
 */
export type LaunchChildFn = (
  piArgs: string[],
  agent: AgentConfig,
  task: string,
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((result: SubagentResult) => void) | undefined,
  stuckTimeoutMs: number,
) => Promise<SubagentResult>;
