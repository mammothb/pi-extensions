/**
 * Single source of truth for every `gen_ai.*` and `pi.*` attribute name
 * emitted by `@mammothb/pi-otel`.
 *
 * Decision D9 in PROPOSAL-pi-otel.md: the GenAI semantic conventions are
 * `Development`-status and `@opentelemetry/semantic-conventions/incubating`
 * exports churn. We hand-define the constants in one audited file rather
 * than depend on a moving package. Re-audit against the spec on every OTel
 * SDK bump.
 *
 * Naming style follows the upstream semconv (lowercase dotted). Values
 * are typed as `const` strings so they can be passed to `setAttribute`
 * without TypeScript widening to `string`.
 */

// ── gen_ai.* (OpenTelemetry GenAI semantic conventions) ───────────────────

/** Operation kind for LLM / tool / agent spans. */
export const GEN_AI_OPERATION_NAME = "gen_ai.operation.name" as const;

/** Operation kinds. */
export const GEN_AI_OPERATION = {
  CHAT: "chat",
  EXECUTE_TOOL: "execute_tool",
  INVOKE_AGENT: "invoke_agent",
} as const;
export type GenAiOperation =
  (typeof GEN_AI_OPERATION)[keyof typeof GEN_AI_OPERATION];

/** Provider / system name (e.g. `anthropic`, `openai`). */
export const GEN_AI_SYSTEM = "gen_ai.system" as const;

/** Model requested by the client. */
export const GEN_AI_REQUEST_MODEL = "gen_ai.request.model" as const;

/** Model reported in the response (may differ when fallbacks engage). */
export const GEN_AI_RESPONSE_MODEL = "gen_ai.response.model" as const;

/** Reasons the model stopped generating. Array-valued. */
export const GEN_AI_RESPONSE_FINISH_REASONS =
  "gen_ai.response.finish_reasons" as const;

/** Input token count. */
export const GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens" as const;

/** Output token count. */
export const GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens" as const;

/** Tool name (for `execute_tool` spans). */
export const GEN_AI_TOOL_NAME = "gen_ai.tool.name" as const;

/** Agent name (for `invoke_agent` spans). */
export const GEN_AI_AGENT_NAME = "gen_ai.agent.name" as const;

/** Conversation / session identifier (alias of `pi.session.id`). */
export const GEN_AI_CONVERSATION_ID = "gen_ai.conversation.id" as const;

/** Set on a chat span following a context compaction. */
export const GEN_AI_CONVERSATION_COMPACTED =
  "gen_ai.conversation.compacted" as const;

/** Token type for `gen_ai.client.token.usage` histogram dimension. */
export const GEN_AI_TOKEN_TYPE = "gen_ai.token.type" as const;

export const GEN_AI_TOKEN_TYPE_VALUE = {
  INPUT: "input",
  OUTPUT: "output",
} as const;

// ── pi.* (harness-specific, not in any semconv) ───────────────────────────

/** Session identifier. Equal to `gen_ai.conversation.id`. */
export const PI_SESSION_ID = "pi.session.id" as const;

/** Cwd of the session, for grouping spans by project. */
export const PI_SESSION_CWD = "pi.session.cwd" as const;

/** Interaction identifier. One per user prompt. Root span name. */
export const PI_INTERACTION_ID = "pi.interaction.id" as const;

/** Index of the current turn within its interaction (0-based). */
export const PI_TURN_INDEX = "pi.turn.index" as const;

/** Tool call id (matches `gen_ai.tool.call_id` semconv under that name). */
export const PI_TOOL_CALL_ID = "pi.tool.call_id" as const;

/** sha256 hex digest of the tool's argument payload (hashed when not
 * captured in cleartext). */
export const PI_TOOL_ARGS_SHA256 = "pi.tool.args_sha256" as const;

/** sha256 hex digest of the tool's result content (hashed when not
 * captured in cleartext). */
export const PI_TOOL_RESULT_SHA256 = "pi.tool.result_sha256" as const;

/** Whether the tool reported an error (`true` / `false`). */
export const PI_TOOL_IS_ERROR = "pi.tool.is_error" as const;

/** Tool name as pi sees it (mirrors `gen_ai.tool.name`). */
export const PI_TOOL_NAME = "pi.tool.name" as const;

/** Session id of a nested agent (e.g. pi-subagents fork). */
export const PI_AGENT_SESSION_ID = "pi.agent.session_id" as const;

// ── Span names ────────────────────────────────────────────────────────────

export const SPAN_NAME = {
  INTERACTION: "pi.interaction",
  TURN: "pi.turn",
  CHAT: "chat",
  EXECUTE_TOOL: "execute_tool",
  INVOKE_AGENT: "invoke_agent",
} as const;
