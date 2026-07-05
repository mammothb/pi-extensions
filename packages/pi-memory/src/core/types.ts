export type CompactionReason = "manual" | "threshold" | "overflow";

export type NormalizedBlock =
  | { kind: "user"; text: string; sourceIndex?: number }
  | { kind: "assistant"; text: string; sourceIndex?: number }
  | {
      kind: "tool_call";
      name: string;
      args: Record<string, unknown>;
      sourceIndex?: number;
    }
  | { kind: "tool_result"; name: string; text: string; sourceIndex?: number }
  | {
      kind: "bash";
      command: string;
      output: string;
      exitCode: number | undefined;
      sourceIndex?: number;
    };
