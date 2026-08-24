/**
 * SpanTracker tests — drive the tracker against a real OTel TracerProvider
 * with an in-memory exporter, then walk the resulting span tree to assert
 * parent/child shape, attribute values, and error status.
 */
import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SPAN_NAME } from "../src/attrs.js";
import { DEFAULT_CAPTURE, DEFAULT_SUMMARY_LENGTH } from "../src/config.js";
import { sha256 } from "../src/content.js";
import { SpanTracker } from "../src/spans.js";

const SESSION_ID = "session-abc-123";
const INTERACTION_ID = "interaction-xyz-789";

/** All BasicTracerProvider instances created during a test, including
 * ones replaced by `makeTracker`, so the test lifecycle can flush and shut
 * them all down without leaking span processors / floating promises. */
const providers: BasicTracerProvider[] = [];

/** Build a fresh in-memory tracer + exporter pair for each test. */
function setupTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  providers.push(provider);
  const tracer = provider.getTracer("@mammothb/pi-otel-test");
  return { exporter, provider, tracer };
}

/** Walk the span tree by name, returning the first match. */
function findSpan(spans: ReadableSpan[], name: string): ReadableSpan {
  const found = spans.find((s) => s.name === name);
  if (!found) {
    const names = spans.map((s) => s.name).join(", ");
    throw new Error(`expected span named "${name}"; got: ${names}`);
  }
  return found;
}

/** Get the parent span for `child` by matching `parentSpanContext`. */
function parentOf(
  spans: ReadableSpan[],
  child: ReadableSpan,
): ReadableSpan | undefined {
  if (!child.parentSpanContext) {
    return undefined;
  }
  return spans.find(
    (s) => s.spanContext().spanId === child.parentSpanContext?.spanId,
  );
}

function chain(spans: ReadableSpan[], leaf: ReadableSpan): string[] {
  const names: string[] = [];
  let cur: ReadableSpan | undefined = leaf;
  while (cur) {
    names.unshift(cur.name);
    cur = parentOf(spans, cur);
  }
  return names;
}

// ===========================================================================
// SpanTracker — one interaction: turn → chat → tool
// ===========================================================================

describe("SpanTracker", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let tracker: SpanTracker;

  beforeEach(() => {
    const setup = setupTracer();
    exporter = setup.exporter;
    provider = setup.provider;
    tracker = new SpanTracker({
      tracer: setup.tracer,
      sessionId: SESSION_ID,
      interactionId: INTERACTION_ID,
      capture: { ...DEFAULT_CAPTURE },
      summaryLength: DEFAULT_SUMMARY_LENGTH,
    });
  });

  afterEach(async () => {
    // Flush every provider (including ones replaced by makeTracker) so any
    // buffered spans are exported, then shut them down to release the span
    // processors. Awaiting both prevents floating promises at teardown.
    await Promise.all(
      providers.map((p) => p.forceFlush().catch(() => undefined)),
    );
    await Promise.all(
      providers.map((p) => p.shutdown().catch(() => undefined)),
    );
    providers.length = 0;
  });

  /** Rebuild the tracker with an overridden capture config. */
  function makeTracker(
    captureOverrides: Partial<typeof DEFAULT_CAPTURE>,
  ): SpanTracker {
    const setup = setupTracer();
    exporter = setup.exporter;
    provider = setup.provider;
    return new SpanTracker({
      tracer: setup.tracer,
      sessionId: SESSION_ID,
      interactionId: INTERACTION_ID,
      capture: { ...DEFAULT_CAPTURE, ...captureOverrides },
      summaryLength: DEFAULT_SUMMARY_LENGTH,
    });
  }

  it("builds interaction > turn > {chat, tool} tree with tool parented to turn (not chat)", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "toolUse",
      usage: { input: 100, output: 50 },
    });
    tracker.beginTool("call-1", "read", { path: "/tmp/x" });
    tracker.endTool("call-1", { ok: true }, false);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const interaction = findSpan(spans, SPAN_NAME.INTERACTION);
    const turn = findSpan(spans, SPAN_NAME.TURN);
    const chat = findSpan(spans, SPAN_NAME.CHAT);
    const tool = findSpan(spans, "execute_tool read");

    // interaction is the root
    expect(parentOf(spans, interaction)).toBeUndefined();
    // turn parented to interaction
    expect(parentOf(spans, turn)?.name).toBe(SPAN_NAME.INTERACTION);
    // chat parented to turn
    expect(parentOf(spans, chat)?.name).toBe(SPAN_NAME.TURN);
    // **tool parented to turn, not chat** — tools execute after the LLM
    expect(parentOf(spans, tool)?.name).toBe(SPAN_NAME.TURN);

    // chain ordering: interaction → turn → tool
    expect(chain(spans, tool)).toEqual([
      SPAN_NAME.INTERACTION,
      SPAN_NAME.TURN,
      "execute_tool read",
    ]);
  });

  it("endInteraction ends unfinished child spans before the root", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0); // left unfinished (no endTurn)
    tracker.endInteraction(); // terminal cleanup
    provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    // Both the dangling child and the interaction root were ended.
    findSpan(spans, SPAN_NAME.INTERACTION);
    findSpan(spans, SPAN_NAME.TURN);
  });

  it("carries session.id, gen_ai.conversation.id, and pi.interaction.id on every span", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "stop",
      usage: { input: 10, output: 20 },
    });
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    for (const span of spans) {
      expect(span.attributes["pi.session.id"]).toBe(SESSION_ID);
      expect(span.attributes["gen_ai.conversation.id"]).toBe(SESSION_ID);
      expect(span.attributes["pi.interaction.id"]).toBe(INTERACTION_ID);
    }
  });

  it("sets gen_ai.* attributes on chat spans from the assistant message", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "openai",
      model: "gpt-5",
      responseModel: "gpt-5-2025-08-01",
      stopReason: "stop",
      usage: {
        input: 42,
        output: 7,
        cacheRead: 1000,
        cacheWrite: 500,
      },
    });
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chat = findSpan(exporter.getFinishedSpans(), SPAN_NAME.CHAT);
    expect(chat.attributes["gen_ai.operation.name"]).toBe("chat");
    expect(chat.attributes["gen_ai.request.model"]).toBe("gpt-5");
    expect(chat.attributes["gen_ai.response.model"]).toBe("gpt-5-2025-08-01");
    expect(chat.attributes["gen_ai.system"]).toBe("openai");
    expect(chat.attributes["gen_ai.usage.input_tokens"]).toBe(42);
    expect(chat.attributes["gen_ai.usage.output_tokens"]).toBe(7);
    expect(chat.attributes["gen_ai.usage.cache_read_input_tokens"]).toBe(1000);
    expect(chat.attributes["gen_ai.usage.cache_write_input_tokens"]).toBe(500);
    expect(chat.attributes["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
    expect(chat.status.code).toBe(SpanStatusCode.UNSET);
  });

  it("omits cache attributes when the provider reports none", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "openai",
      model: "gpt-5",
      stopReason: "stop",
      usage: { input: 1, output: 1 },
    });
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chat = findSpan(exporter.getFinishedSpans(), SPAN_NAME.CHAT);
    expect(
      chat.attributes["gen_ai.usage.cache_read_input_tokens"],
    ).toBeUndefined();
    expect(
      chat.attributes["gen_ai.usage.cache_write_input_tokens"],
    ).toBeUndefined();
  });

  it("marks chat span as ERROR on non-2xx HTTP response", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat(
      {
        provider: "anthropic",
        model: "claude-opus-4-5",
        stopReason: "error",
        usage: { input: 0, output: 0 },
        errorMessage: "rate limited",
      },
      429,
    );
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chat = findSpan(exporter.getFinishedSpans(), SPAN_NAME.CHAT);
    expect(chat.status.code).toBe(SpanStatusCode.ERROR);
    expect(chat.attributes["error.type"]).toBe("http_429");
  });

  it("marks tool span as ERROR when tool reports isError=true", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "toolUse",
      usage: { input: 1, output: 1 },
    });
    tracker.beginTool("call-fail", "bash", { cmd: "rm -rf /" });
    tracker.endTool("call-fail", "permission denied", true);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const tool = findSpan(exporter.getFinishedSpans(), "execute_tool bash");
    expect(tool.status.code).toBe(SpanStatusCode.ERROR);
    expect(tool.attributes["pi.tool.is_error"]).toBe(true);
    expect(tool.attributes["error.type"]).toBe("tool_error");
  });

  it("sets pi.tool.* attributes on tool spans", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "toolUse",
      usage: { input: 1, output: 1 },
    });
    tracker.beginTool("call-42", "grep", "pattern=foo");
    tracker.endTool("call-42", "no matches", false);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const tool = findSpan(exporter.getFinishedSpans(), "execute_tool grep");
    expect(tool.attributes["gen_ai.operation.name"]).toBe("execute_tool");
    expect(tool.attributes["gen_ai.tool.name"]).toBe("grep");
    expect(tool.attributes["pi.tool.name"]).toBe("grep");
    expect(tool.attributes["pi.tool.call_id"]).toBe("call-42");
    expect(tool.attributes["pi.tool.args_sha256"]).toBe(sha256("pattern=foo"));
    expect(tool.attributes["pi.tool.result_sha256"]).toBe(sha256("no matches"));
    expect(tool.attributes["pi.tool.is_error"]).toBe(false);
  });

  // ── nested agent (pi-subagents fork) ────────────────────────────────

  it("nests an invoke_agent span under the active tool", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "toolUse",
      usage: { input: 1, output: 1 },
    });
    tracker.beginTool("call-task", "task", { subagent: true });
    tracker.beginNestedAgent("researcher", "sub-session-1");
    tracker.endNestedAgent();
    tracker.endTool("call-task", "done", false);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const agent = findSpan(spans, "invoke_agent researcher");
    const tool = findSpan(spans, "execute_tool task");

    // invoke_agent is a child of the tool span
    expect(parentOf(spans, agent)?.name).toBe("execute_tool task");
    expect(agent.attributes["gen_ai.operation.name"]).toBe("invoke_agent");
    expect(agent.attributes["gen_ai.agent.name"]).toBe("researcher");
    expect(agent.attributes["pi.agent.session_id"]).toBe("sub-session-1");

    // tool still parents to the turn (the agent doesn't displace it)
    expect(parentOf(spans, tool)?.name).toBe(SPAN_NAME.TURN);
  });

  // ── compaction flag ─────────────────────────────────────────────────

  it("flips gen_ai.conversation.compacted on the chat after a compaction event", () => {
    // First interaction: normal chat, no compaction flag
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "toolUse",
      usage: { input: 1, output: 1 },
    });
    tracker.endTurn();
    tracker.markCompacted();
    tracker.recordAgentEvent("compaction", { reason: "threshold" });
    tracker.endInteraction();

    // Second interaction (same tracker) reuses the compaction flag
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "stop",
      usage: { input: 1, output: 1 },
    });
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chats = exporter
      .getFinishedSpans()
      .filter((s) => s.name === SPAN_NAME.CHAT);
    expect(chats).toHaveLength(2);
    // First chat: not compacted
    expect(
      chats[0]?.attributes["gen_ai.conversation.compacted"],
    ).toBeUndefined();
    // Second chat: compacted flag set
    expect(chats[1]?.attributes["gen_ai.conversation.compacted"]).toBe(true);

    // The interaction root carries the "compaction" span event
    const interactions = exporter
      .getFinishedSpans()
      .filter((s) => s.name === SPAN_NAME.INTERACTION);
    expect(interactions[0]?.events.some((e) => e.name === "compaction")).toBe(
      true,
    );
  });

  // ── content capture gating ─────────────────────────────────────────

  it("emits tool args hash but no raw args when capture.toolArgs is off (default)", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "toolUse",
      usage: { input: 1, output: 1 },
    });
    tracker.beginTool("call-1", "read", "secret args");
    tracker.endTool("call-1", "secret result", false);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const tool = findSpan(exporter.getFinishedSpans(), "execute_tool read");
    expect(tool.attributes["pi.tool.args_sha256"]).toBe(sha256("secret args"));
    expect(tool.attributes["pi.tool.result_sha256"]).toBe(
      sha256("secret result"),
    );
    // raw content absent — hashes only
    expect(tool.attributes["pi.tool.args"]).toBeUndefined();
    expect(tool.attributes["pi.tool.result"]).toBeUndefined();
  });

  it("emits truncated raw tool args when capture.toolArgs is on", () => {
    tracker = makeTracker({ toolArgs: true });
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginTool("call-1", "read", "x".repeat(2000));
    tracker.endTool("call-1", "ok", false);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const tool = findSpan(exporter.getFinishedSpans(), "execute_tool read");
    const rawArgs = tool.attributes["pi.tool.args"] as string;
    expect(rawArgs).toBeDefined();
    expect(rawArgs).toBe(`${"x".repeat(DEFAULT_SUMMARY_LENGTH)}…`);
    // hash is of the *untruncated* input
    expect(tool.attributes["pi.tool.args_sha256"]).toBe(
      sha256("x".repeat(2000)),
    );
  });

  it("emits prompt as a span event when capture.prompts is on", () => {
    tracker = makeTracker({ prompts: true });
    tracker.beginInteraction();
    tracker.recordPrompt("tell me a secret");
    tracker.endInteraction();
    provider.forceFlush();

    const interaction = findSpan(
      exporter.getFinishedSpans(),
      SPAN_NAME.INTERACTION,
    );
    const promptEvent = interaction.events.find((e) => e.name === "prompt");
    expect(promptEvent).toBeDefined();
    expect(promptEvent?.attributes?.["pi.prompt.text"]).toBe(
      "tell me a secret",
    );
  });

  it("does not emit prompt when capture.prompts is off", () => {
    tracker.beginInteraction();
    tracker.recordPrompt("tell me a secret");
    tracker.endInteraction();
    provider.forceFlush();

    const interaction = findSpan(
      exporter.getFinishedSpans(),
      SPAN_NAME.INTERACTION,
    );
    expect(interaction.events.some((e) => e.name === "prompt")).toBe(false);
  });

  it("emits provider payloads when capture.providerPayloads is on", () => {
    tracker = makeTracker({ providerPayloads: true });
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat(
      {
        provider: "anthropic",
        model: "claude-opus-4-5",
        stopReason: "stop",
        usage: { input: 1, output: 1 },
      },
      undefined,
      { request: { system: "sys" }, response: { text: "hello" } },
    );
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chat = findSpan(exporter.getFinishedSpans(), SPAN_NAME.CHAT);
    expect(chat.attributes["pi.provider.request"]).toBe('{"system":"sys"}');
    expect(chat.attributes["pi.provider.response"]).toBe('{"text":"hello"}');
    // hash is always emitted, even when raw content is also captured
    expect(chat.attributes["pi.provider.request_sha256"]).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(chat.attributes["pi.provider.response_sha256"]).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("does not emit provider payloads when capture.providerPayloads is off", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat(
      {
        provider: "anthropic",
        model: "claude-opus-4-5",
        stopReason: "stop",
        usage: { input: 1, output: 1 },
      },
      undefined,
      { request: { system: "sys" }, response: { text: "hello" } },
    );
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chat = findSpan(exporter.getFinishedSpans(), SPAN_NAME.CHAT);
    expect(chat.attributes["pi.provider.request"]).toBeUndefined();
    expect(chat.attributes["pi.provider.response"]).toBeUndefined();
    // hash is emitted unconditionally, regardless of the capture flag
    expect(chat.attributes["pi.provider.request_sha256"]).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(chat.attributes["pi.provider.response_sha256"]).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("marks chat span as ERROR on message-derived error without HTTP status", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "error",
      usage: { input: 0, output: 0 },
      errorMessage: "provider exploded",
    });
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chat = findSpan(exporter.getFinishedSpans(), SPAN_NAME.CHAT);
    expect(chat.status.code).toBe(SpanStatusCode.ERROR);
    expect(chat.status.message).toBe("provider exploded");
    expect(chat.attributes["error.type"]).toBe("error");
  });

  it("marks chat span as ERROR on abort with no error message", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.endChat({
      provider: "anthropic",
      model: "claude-opus-4-5",
      stopReason: "aborted",
      usage: { input: 0, output: 0 },
    });
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const chat = findSpan(exporter.getFinishedSpans(), SPAN_NAME.CHAT);
    expect(chat.status.code).toBe(SpanStatusCode.ERROR);
    expect(chat.attributes["error.type"]).toBe("aborted");
  });

  it("recordAgentEvent no-ops when no interaction is open", () => {
    tracker.recordAgentEvent("model_select", { model: "claude" });
    provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("recordPrompt no-ops on an empty stack even when capture.prompts is on", () => {
    const t = makeTracker({ prompts: true });
    t.recordPrompt("hello");
    provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("closeAll ends spans left dangling on the stack", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginChat();
    tracker.closeAll();
    provider.forceFlush();

    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain(SPAN_NAME.INTERACTION);
    expect(names).toContain(SPAN_NAME.TURN);
    expect(names).toContain(SPAN_NAME.CHAT);
  });

  it("endTool closes the span matching the completion event, not LIFO order", () => {
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginTool("call-a", "read", {});
    tracker.beginTool("call-b", "bash", {});
    // call-a's completion arrives first, though call-b was started last
    tracker.endTool("call-a", "result-a", false);
    tracker.endTool("call-b", "result-b", false);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const a = findSpan(spans, "execute_tool read");
    const b = findSpan(spans, "execute_tool bash");
    expect(a.attributes["pi.tool.call_id"]).toBe("call-a");
    expect(a.attributes["pi.tool.result_sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(b.attributes["pi.tool.call_id"]).toBe("call-b");
    expect(b.attributes["pi.tool.result_sha256"]).toMatch(/^[0-9a-f]{64}$/);
    // Each span carries its own result's hash, proving completion-by-id
    // (call-a's span did not absorb call-b's result, and vice versa).
    expect(a.attributes["pi.tool.result_sha256"]).not.toBe(
      b.attributes["pi.tool.result_sha256"],
    );
  });

  it("endTool no-ops when no tool span is open", () => {
    tracker.endTool("orphan-call", "orphan result", false);
    provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("emits truncated raw tool result when capture.toolResults is on", () => {
    tracker = makeTracker({ toolResults: true });
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginTool("call-1", "read", {});
    tracker.endTool("call-1", "r".repeat(2000), false);
    tracker.endTurn();
    tracker.endInteraction();
    provider.forceFlush();

    const tool = findSpan(exporter.getFinishedSpans(), "execute_tool read");
    const rawResult = tool.attributes["pi.tool.result"] as string;
    expect(rawResult).toBe(`${"r".repeat(DEFAULT_SUMMARY_LENGTH)}…`);
    expect(tool.attributes["pi.tool.result_sha256"]).toBe(
      sha256("r".repeat(2000)),
    );
  });
});
