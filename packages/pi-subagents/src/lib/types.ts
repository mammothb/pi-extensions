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
  /** Individual results when executing in parallel mode. Omitted for single mode. */
  results?: SubagentResult[];
}

export interface SubagentConfig {
  tiers: Record<string, string>;
  stuckTimeoutMs: number;
}
