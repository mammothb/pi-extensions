/**
 * SpanTracker: stateful orchestrator for the pi.→OTel trace tree.
 *
 * One tracker is created per interaction (per `beginInteraction` call). The
 * tracker maintains an internal stack of active spans so nested events
 * (turn inside interaction, chat/tool inside turn, nested agent inside tool)
 * produce the correct parent-child shape without relying on the OTel
 * context to have the right active span at any given moment.
 *
 * Every span this tracker emits carries:
 *   - `pi.session.id` and `gen_ai.conversation.id` (the same value; the
 *     session is modeled as an attribute, never a span)
 *   - `pi.interaction.id` (set on every span; the interaction root carries
 *     it too, redundantly, for uniform query)
 *
 * Resource attributes (service.name, host.name, user.*) are set on the
 * OTel `Resource` at SDK init and inherit automatically.
 *
 * Covers span shape, parent resolution, gen_ai attribute mapping, error
 * status, and content capture. Hashing and capture-mode gating live in
 * `content.ts`; the tracker emits sha256 hashes always, and raw (truncated)
 * content only when the matching `capture.*` flag is on.
 */
import {
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";
import { ATTR_ERROR_TYPE } from "@opentelemetry/semantic-conventions";
import {
  GEN_AI_AGENT_NAME,
  GEN_AI_CONVERSATION_COMPACTED,
  GEN_AI_CONVERSATION_ID,
  GEN_AI_OPERATION,
  GEN_AI_OPERATION_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_FINISH_REASONS,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_SYSTEM,
  GEN_AI_TOOL_NAME,
  GEN_AI_USAGE_CACHE_READ_TOKENS,
  GEN_AI_USAGE_CACHE_WRITE_TOKENS,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  PI_AGENT_SESSION_ID,
  PI_CHAT_ERROR_TYPE,
  PI_INTERACTION_ID,
  PI_PROMPT_TEXT,
  PI_PROVIDER_REQUEST,
  PI_PROVIDER_REQUEST_SHA256,
  PI_PROVIDER_RESPONSE,
  PI_PROVIDER_RESPONSE_SHA256,
  PI_SESSION_ID,
  PI_TOOL_ARGS,
  PI_TOOL_ARGS_SHA256,
  PI_TOOL_CALL_ID,
  PI_TOOL_IS_ERROR,
  PI_TOOL_NAME,
  PI_TOOL_RESULT,
  PI_TOOL_RESULT_SHA256,
  PI_TURN_INDEX,
  SPAN_NAME,
} from "./attrs.js";
import type { CaptureConfig } from "./config.js";
import { applyCaptureMode, toContent } from "./content.js";

/** Span attribute value type (mirrors the OTel attribute value union). */
type SpanAttrValue = string | number | boolean;

/** Kind of span held on the tracker stack, used to match end events. */
type StackKind = "interaction" | "turn" | "chat" | "tool" | "nestedAgent";

/** A span on the tracker stack, tagged with its kind so end events can
 * remove the matching entry rather than relying on LIFO order. Tool spans
 * also carry `toolCallId` for direct lookup on completion. */
interface StackEntry {
  span: Span;
  kind: StackKind;
  toolCallId?: string;
}

/** Subset of an assistant message that endChat needs. `usage.cacheRead` /
 * `usage.cacheWrite` (prompt-cache hits/writes) are optional because not
 * every provider reports them; when present they are excluded from the
 * plain input count by the provider, so they get their own attributes. */
export interface ChatMessageInfo {
  provider: string;
  model: string;
  responseModel?: string;
  stopReason: string;
  usage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  isError?: boolean;
  errorMessage?: string;
}

export interface SpanTrackerOptions {
  tracer: Tracer;
  sessionId: string;
  interactionId: string;
  /** Content-capture flags (from resolved config). */
  capture: CaptureConfig;
  /** Max chars of captured content before truncation. */
  summaryLength: number;
}

/**
 * Per-interaction span tree. One tracker instance per user prompt; dispose
 * via `endInteraction()`.
 */
export class SpanTracker {
  private readonly _tracer: Tracer;
  private readonly _sessionId: string;
  private readonly _interactionId: string;
  private readonly _capture: CaptureConfig;
  private readonly _summaryLength: number;
  /** Active-span stack. Each entry is tagged with its kind so end events
   * remove the matching span instead of assuming strict LIFO nesting.
   * The top entry is the current parent for new spans. */
  private readonly _stack: StackEntry[] = [];
  /** Open tool spans, keyed by `toolCallId`, for completion-by-id lookup. */
  private readonly _tools = new Map<string, StackEntry>();
  /** Most recent turn span — used so chat/tool children pick the right
   * parent even when a chat ends before its tools start. */
  private _turn: Span | undefined;
  /** Set by `markCompacted()`; consumed by the next `beginChat`. */
  private _compacted = false;

  constructor(options: SpanTrackerOptions) {
    this._tracer = options.tracer;
    this._sessionId = options.sessionId;
    this._interactionId = options.interactionId;
    this._capture = options.capture;
    this._summaryLength = options.summaryLength;
  }

  /** Start the `pi.interaction` root span. Call once per user prompt. */
  beginInteraction(): Span {
    const span = this._startSpan(
      SPAN_NAME.INTERACTION,
      SpanKind.INTERNAL,
      undefined,
      {
        [PI_INTERACTION_ID]: this._interactionId,
      },
    );
    this._stack.push({ span, kind: "interaction" });
    return span;
  }

  /** Close the interaction root and any unfinished children. Terminal —
   * pairs with beginInteraction; a hard exit may leave child spans (turn/
   * chat/tool) open on the stack, so delegate to closeAll() to end them
   * before the root and clear the stack. */
  endInteraction(): void {
    this.closeAll();
  }

  /** Start a `pi.turn` child of the active interaction. */
  beginTurn(turnIndex: number): Span {
    const parent = this._stack[this._stack.length - 1]?.span;
    const span = this._startSpan(SPAN_NAME.TURN, SpanKind.INTERNAL, parent, {
      [PI_TURN_INDEX]: turnIndex,
    });
    this._turn = span;
    this._stack.push({ span, kind: "turn" });
    return span;
  }

  /** Close the active turn. Removes the matching entry from the stack. */
  endTurn(): void {
    const entry = this._removeByKind("turn");
    if (entry) {
      entry.span.end();
    }
    if (this._turn === entry?.span) {
      this._turn = undefined;
    }
  }

  /** Start a `chat <model>` child of the active turn. */
  beginChat(): Span {
    const attrs: Record<string, SpanAttrValue> = {
      [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.CHAT,
    };
    if (this._compacted) {
      attrs[GEN_AI_CONVERSATION_COMPACTED] = true;
      this._compacted = false;
    }
    const parent = this._stack[this._stack.length - 1]?.span;
    const span = this._startSpan(
      SPAN_NAME.CHAT,
      SpanKind.CLIENT,
      parent,
      attrs,
    );
    this._stack.push({ span, kind: "chat" });
    return span;
  }

  /**
   * Close the active chat. Pulls model / provider / usage / finish reasons
   * from the assistant message and sets the appropriate status. If the
   * provider returned a non-2xx HTTP status, the span is marked ERROR.
   * When `capture.providerPayloads` is on, the request/response bodies are
   * emitted (truncated).
   */
  endChat(
    message: ChatMessageInfo,
    responseStatus?: number,
    providerPayload?: { request?: unknown; response?: unknown },
  ): void {
    const entry = this._removeByKind("chat");
    if (!entry) {
      return;
    }
    const span = entry.span;

    span.setAttribute(GEN_AI_REQUEST_MODEL, message.model);
    span.setAttribute(
      GEN_AI_RESPONSE_MODEL,
      message.responseModel ?? message.model,
    );
    span.setAttribute(GEN_AI_SYSTEM, message.provider);
    span.setAttribute(GEN_AI_USAGE_INPUT_TOKENS, message.usage.input);
    span.setAttribute(GEN_AI_USAGE_OUTPUT_TOKENS, message.usage.output);
    if (
      typeof message.usage.cacheRead === "number" &&
      message.usage.cacheRead > 0
    ) {
      span.setAttribute(
        GEN_AI_USAGE_CACHE_READ_TOKENS,
        message.usage.cacheRead,
      );
    }
    if (
      typeof message.usage.cacheWrite === "number" &&
      message.usage.cacheWrite > 0
    ) {
      span.setAttribute(
        GEN_AI_USAGE_CACHE_WRITE_TOKENS,
        message.usage.cacheWrite,
      );
    }
    span.setAttribute(GEN_AI_RESPONSE_FINISH_REASONS, [message.stopReason]);

    this._classifyChatError(span, message, responseStatus);

    if (providerPayload?.request !== undefined) {
      const captured = applyCaptureMode(
        toContent(providerPayload.request),
        this._capture.providerPayloads ? "summary" : "off",
        this._summaryLength,
      );
      // Hash is always emitted (matches beginTool/endTool), so payloads are
      // attributable even when raw content capture is off.
      span.setAttribute(PI_PROVIDER_REQUEST_SHA256, captured.sha256);
      if (captured.content !== undefined) {
        span.setAttribute(PI_PROVIDER_REQUEST, captured.content);
      }
    }
    if (providerPayload?.response !== undefined) {
      const captured = applyCaptureMode(
        toContent(providerPayload.response),
        this._capture.providerPayloads ? "summary" : "off",
        this._summaryLength,
      );
      span.setAttribute(PI_PROVIDER_RESPONSE_SHA256, captured.sha256);
      if (captured.content !== undefined) {
        span.setAttribute(PI_PROVIDER_RESPONSE, captured.content);
      }
    }

    span.end();
  }

  /** Record the chat error status/classification on `span`.
   * Precedence: HTTP non-2xx status wins (canonical signal), then an
   * abort, then a generic provider error — matching the chat error-type
   * metric vocabulary (http_* / aborted / error), not the provider name. */
  private _classifyChatError(
    span: Span,
    message: ChatMessageInfo,
    responseStatus?: number,
  ): void {
    if (
      responseStatus !== undefined &&
      (responseStatus < 200 || responseStatus >= 300)
    ) {
      span.setAttribute(ATTR_ERROR_TYPE, `http_${responseStatus}`);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${responseStatus}`,
      });
      return;
    }
    if (message.stopReason === "aborted") {
      span.setAttribute(ATTR_ERROR_TYPE, "aborted");
      span.setAttribute(PI_CHAT_ERROR_TYPE, "aborted");
      span.setStatus({ code: SpanStatusCode.ERROR });
      return;
    }
    if (message.isError || message.stopReason === "error") {
      span.setAttribute(ATTR_ERROR_TYPE, "error");
      span.setAttribute(PI_CHAT_ERROR_TYPE, "error");
      span.setStatus(
        message.errorMessage
          ? { code: SpanStatusCode.ERROR, message: message.errorMessage }
          : { code: SpanStatusCode.ERROR },
      );
    }
  }

  /**
   * Start an `execute_tool <toolName>` child of the active turn (not the
   * chat — tools execute *after* the LLM responds, so the turn is the
   * correct parent). Always sets `pi.tool.args_sha256`; the raw (truncated)
   * args are emitted only when `capture.toolArgs` is on.
   */
  beginTool(toolCallId: string, toolName: string, args: unknown): Span {
    const captured = applyCaptureMode(
      toContent(args),
      this._capture.toolArgs ? "summary" : "off",
      this._summaryLength,
    );
    const attrs: Record<string, SpanAttrValue> = {
      [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.EXECUTE_TOOL,
      [GEN_AI_TOOL_NAME]: toolName,
      [PI_TOOL_NAME]: toolName,
      [PI_TOOL_CALL_ID]: toolCallId,
      [PI_TOOL_ARGS_SHA256]: captured.sha256,
    };
    if (captured.content !== undefined) {
      attrs[PI_TOOL_ARGS] = captured.content;
    }
    const span = this._startSpan(
      `${SPAN_NAME.EXECUTE_TOOL} ${toolName}`,
      SpanKind.CLIENT,
      this._turn,
      attrs,
    );
    const entry: StackEntry = { span, kind: "tool", toolCallId };
    this._stack.push(entry);
    this._tools.set(toolCallId, entry);
    return span;
  }

  /** Close the active tool. Sets `pi.tool.result_sha256` always (raw result
   * only when `capture.toolResults` is on), `pi.tool.is_error`, and ERROR
   * status on failure. */
  endTool(toolCallId: string, result: unknown, isError: boolean): void {
    const entry = this._tools.get(toolCallId);
    if (!entry) {
      return;
    }
    this._tools.delete(toolCallId);
    this._removeEntry(entry);
    const span = entry.span;
    const captured = applyCaptureMode(
      toContent(result),
      this._capture.toolResults ? "summary" : "off",
      this._summaryLength,
    );
    span.setAttribute(PI_TOOL_RESULT_SHA256, captured.sha256);
    if (captured.content !== undefined) {
      span.setAttribute(PI_TOOL_RESULT, captured.content);
    }
    span.setAttribute(PI_TOOL_IS_ERROR, isError);
    if (isError) {
      span.setAttribute(ATTR_ERROR_TYPE, "tool_error");
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "tool reported isError",
      });
    }
    span.end();
  }

  /**
   * Start a nested `invoke_agent` span as a child of the active tool (or
   * turn if no tool is active). Used by subagent / fork extensions.
   */
  beginNestedAgent(name: string, sessionId?: string): Span {
    const parent =
      this._stack[this._stack.length - 1]?.span ?? this._turn ?? undefined;
    const attrs: Record<string, SpanAttrValue> = {
      [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.INVOKE_AGENT,
      [GEN_AI_AGENT_NAME]: name,
    };
    if (sessionId) {
      attrs[PI_AGENT_SESSION_ID] = sessionId;
    }
    const span = this._startSpan(
      `${SPAN_NAME.INVOKE_AGENT} ${name}`,
      SpanKind.CLIENT,
      parent,
      attrs,
    );
    this._stack.push({ span, kind: "nestedAgent" });
    return span;
  }

  /** Close the active nested agent span (matched by kind). */
  endNestedAgent(): void {
    this._removeByKind("nestedAgent")?.span.end();
  }

  /**
   * Add a span event to the active interaction (model switch, fork, tree,
   * etc.). For session-scoped events, prefer `markCompacted()` for
   * compaction so the next chat span can advertise the compacted state.
   */
  recordAgentEvent(
    name: string,
    attrs?: Record<string, SpanAttrValue | string[]>,
  ): void {
    // The interaction root is the bottom of the stack; tools/chats may
    // still be above it. We attach the event to the root by walking to
    // the first span in the stack.
    const root = this._stack[0]?.span;
    if (!root) {
      return;
    }
    root.addEvent(name, attrs);
  }

  /**
   * Capture the user prompt as a span event on the interaction root. Only
   * emits when `capture.prompts` is on.
   */
  recordPrompt(prompt: string): void {
    if (!this._capture.prompts) {
      return;
    }
    const root = this._stack[0]?.span;
    if (!root) {
      return;
    }
    const captured = applyCaptureMode(prompt, "summary", this._summaryLength);
    root.addEvent("prompt", { [PI_PROMPT_TEXT]: captured.content ?? "" });
  }

  /** Flag the next chat span with `gen_ai.conversation.compacted = true`. */
  markCompacted(): void {
    this._compacted = true;
  }

  /** Close everything still on the stack. Defensive — `agent_end` and
   * `session_shutdown` should pair with their respective begin calls, but
   * a hard exit may leave dangling spans. */
  closeAll(): void {
    while (this._stack.length > 0) {
      this._stack.pop()?.span.end();
    }
    this._tools.clear();
    this._turn = undefined;
  }

  // ── internals ────────────────────────────────────────────────────────

  /** Find the topmost stack entry of the given kind and remove it. Returns
   * the removed entry, or `undefined` if none matches (leaving the stack
   * unchanged). This avoids corrupting the stack when an end event arrives
   * without a matching open span. */
  private _removeByKind(kind: StackKind): StackEntry | undefined {
    for (let i = this._stack.length - 1; i >= 0; i--) {
      const entry = this._stack[i];
      if (entry && entry.kind === kind) {
        return this._stack.splice(i, 1)[0];
      }
    }
    return undefined;
  }

  /** Remove a specific entry (e.g. a tool span closed by call id). */
  private _removeEntry(entry: StackEntry): void {
    const i = this._stack.indexOf(entry);
    if (i >= 0) {
      this._stack.splice(i, 1);
    }
  }

  // ── internals ────────────────────────────────────────────────────────

  /** Start a span with the standard session/interaction attributes and the
   * given parent. Uses `trace.setSpan(ctx, parent)` so the span is a child
   * of `parent` regardless of the OTel active context. */
  private _startSpan(
    name: string,
    kind: SpanKind,
    parent: Span | undefined,
    extraAttrs?: Record<string, SpanAttrValue>,
  ): Span {
    const attrs: Record<string, SpanAttrValue> = {
      [PI_SESSION_ID]: this._sessionId,
      [GEN_AI_CONVERSATION_ID]: this._sessionId,
      [PI_INTERACTION_ID]: this._interactionId,
      ...extraAttrs,
    };
    const opts = { kind, attributes: attrs };
    const ctx = parent
      ? trace.setSpan(context.active(), parent)
      : context.active();
    return this._tracer.startSpan(name, opts, ctx);
  }
}
