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
