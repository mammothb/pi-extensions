/** Payload for AskUserQuestion:prompt event. */
export interface AskPromptPayload {
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description?: string }>;
    multi: boolean;
    recommended?: number;
  }>;
}

/** Payload for <toolName>_permission:prompt events. */
export interface PermissionPromptPayload {
  toolName: string;
  category: "tool" | "bash" | "path";
  summary: string;
  reason?: string;
}
