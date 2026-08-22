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
import { beforeEach, describe, expect, it } from "vitest";
import { SPAN_NAME } from "../src/attrs.js";
import { DEFAULT_CAPTURE, DEFAULT_SUMMARY_LENGTH } from "../src/config.js";
import { sha256 } from "../src/content.js";
import { SpanTracker } from "../src/spans.js";

const SESSION_ID = "session-abc-123";
const INTERACTION_ID = "interaction-xyz-789";

/** Build a fresh in-memory tracer + exporter pair for each test. */
function setupTracer() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
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
    tracker.endTool({ ok: true }, false);
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
      usage: { input: 42, output: 7 },
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
    expect(chat.attributes["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
    expect(chat.status.code).toBe(SpanStatusCode.UNSET);
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
    tracker.endTool("permission denied", true);
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
    tracker.endTool("no matches", false);
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
    tracker.endTool("done", false);
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
    tracker.endTool("secret result", false);
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
    tracker.endTool("ok", false);
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
    expect(chat.attributes["error.type"]).toBe("anthropic");
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
    expect(chat.attributes["error.type"]).toBe("anthropic");
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

  it("endTool no-ops when no tool span is open", () => {
    tracker.endTool("orphan result", false);
    provider.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("emits truncated raw tool result when capture.toolResults is on", () => {
    tracker = makeTracker({ toolResults: true });
    tracker.beginInteraction();
    tracker.beginTurn(0);
    tracker.beginTool("call-1", "read", {});
    tracker.endTool("r".repeat(2000), false);
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
