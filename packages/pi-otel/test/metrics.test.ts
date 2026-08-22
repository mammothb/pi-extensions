/**
 * Metrics tests — drive the real `index.ts` factory with a mocked `pi`
 * (ExtensionAPI) interface, stubbing only the SDK lifecycle (`sdk.ts`) so
 * no real OTLP exporters spin up. The test registers its own MeterProvider
 * with an in-memory exporter and asserts the recorded instruments.
 */
import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  type DataPoint,
  type Histogram,
  type HistogramMetricData,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
  type SumMetricData,
} from "@opentelemetry/sdk-metrics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the SDK lifecycle: initSdk returns a dummy handle, startSdk is a
// no-op (so the test's MeterProvider stays the global one), shutdownSdk
// resolves, and isInitialized reports true so session_shutdown tears the
// tracker down.
vi.mock("../src/sdk.js", () => ({
  initSdk: vi.fn().mockResolvedValue({}),
  startSdk: vi.fn(),
  shutdownSdk: vi.fn().mockResolvedValue(undefined),
  isInitialized: vi.fn(() => true),
}));

// Imported after the mock so the factory binds to the stubbed sdk module.
import piOtelExtension from "../index.js";
import { Metrics } from "../src/metrics.js";

const SESSION_ID = "metrics-session-1";

/** Minimal `pi` (ExtensionAPI) mock that captures event handlers. */
type Handlers = Map<string, Array<(event: unknown, ctx?: unknown) => unknown>>;

function createMockPi(): { pi: unknown; handlers: Handlers } {
  const handlers: Handlers = new Map();
  const pi = {
    on(event: string, handler: (event: unknown, ctx?: unknown) => unknown) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerCommand() {
      // no-op: command registration is not under test here
    },
  };
  return { pi, handlers };
}

function ctx() {
  return {
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => SESSION_ID },
  };
}

function fire(
  handlers: Handlers,
  event: string,
  payload: unknown,
  c?: unknown,
): Promise<unknown> {
  const list = handlers.get(event) ?? [];
  return Promise.all(list.map((h) => h(payload, c)));
}

// ── metric collection helpers ──────────────────────────────────────────

function flatten(resourceMetrics: ResourceMetrics[]): MetricData[] {
  return resourceMetrics.flatMap((rm) =>
    rm.scopeMetrics.flatMap((sm) => sm.metrics),
  );
}

function findMetric(
  resourceMetrics: ResourceMetrics[],
  name: string,
): MetricData | undefined {
  return flatten(resourceMetrics).find((m) => m.descriptor.name === name);
}

function sumPoints(metric: MetricData | undefined): DataPoint<number>[] {
  return (metric as SumMetricData | undefined)?.dataPoints ?? [];
}

function histogramPoints(
  metric: MetricData | undefined,
): DataPoint<Histogram>[] {
  return (metric as HistogramMetricData | undefined)?.dataPoints ?? [];
}

// ===========================================================================
// Metrics — driven through the real index.ts factory
// ===========================================================================

describe("Metrics", () => {
  let exporter: InMemoryMetricExporter;
  let provider: MeterProvider;

  beforeEach(() => {
    // Clear any previously-registered global meter provider so each test
    // installs a fresh one (the OTel API is first-writer-wins otherwise).
    metrics.disable();
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter,
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);
  });

  afterEach(() => {
    metrics.disable();
  });

  it("records prompt, turn, tool-call counters and token usage across one interaction", async () => {
    const { pi, handlers } = createMockPi();
    piOtelExtension(pi as never);

    await fire(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx(),
    );
    await fire(
      handlers,
      "before_agent_start",
      { type: "before_agent_start", prompt: "hi" },
      ctx(),
    );
    await fire(handlers, "turn_start", {
      type: "turn_start",
      turnIndex: 0,
      timestamp: Date.now(),
    });
    await fire(handlers, "before_provider_request", {
      type: "before_provider_request",
      payload: {},
    });
    await fire(handlers, "message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-opus-4-5",
        stopReason: "toolUse",
        usage: { input: 100, output: 50 },
      },
    });
    await fire(handlers, "tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
      args: {},
    });
    await fire(handlers, "tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "read",
      result: {},
      isError: false,
    });
    await fire(handlers, "turn_end", { type: "turn_end", turnIndex: 0 });
    await fire(handlers, "agent_end", { type: "agent_end", messages: [] });
    await fire(handlers, "session_shutdown", {
      type: "session_shutdown",
      reason: "quit",
    });

    await provider.forceFlush();
    const rms = exporter.getMetrics();

    // pi.prompt.count — exactly one increment
    const prompt = findMetric(rms, "pi.prompt.count");
    expect(sumPoints(prompt)).toHaveLength(1);
    expect(sumPoints(prompt)[0]?.value).toBe(1);

    // pi.turn.count — exactly one increment
    const turn = findMetric(rms, "pi.turn.count");
    expect(sumPoints(turn)).toHaveLength(1);
    expect(sumPoints(turn)[0]?.value).toBe(1);

    // pi.tool.calls — one success call with the correct dimensions
    const toolCalls = findMetric(rms, "pi.tool.calls");
    expect(sumPoints(toolCalls)).toHaveLength(1);
    const toolPoint = sumPoints(toolCalls)[0];
    expect(toolPoint?.value).toBe(1);
    expect(toolPoint?.attributes["pi.tool.name"]).toBe("read");
    expect(toolPoint?.attributes["pi.tool.is_error"]).toBe(false);

    // pi.tool.duration — one observation per tool execution, keyed by name
    // (no unit, so Prometheus keeps the bare name `pi_tool_duration_bucket`).
    const toolDuration = findMetric(rms, "pi.tool.duration");
    const toolDurPoints = histogramPoints(toolDuration);
    expect(toolDurPoints).toHaveLength(1);
    expect(toolDurPoints[0]?.attributes["pi.tool.name"]).toBe("read");

    // gen_ai.client.token.usage — two data points: input (100) and output (50)
    const tokenUsage = findMetric(rms, "gen_ai.client.token.usage");
    const tokenPoints = histogramPoints(tokenUsage);
    expect(tokenPoints).toHaveLength(2);
    const inputPoint = tokenPoints.find(
      (p) => p.attributes["gen_ai.token.type"] === "input",
    );
    const outputPoint = tokenPoints.find(
      (p) => p.attributes["gen_ai.token.type"] === "output",
    );
    expect(inputPoint).toBeDefined();
    expect(outputPoint).toBeDefined();
    expect(inputPoint?.value.sum).toBe(100);
    expect(outputPoint?.value.sum).toBe(50);
    expect(inputPoint?.attributes["gen_ai.request.model"]).toBe(
      "claude-opus-4-5",
    );
    expect(inputPoint?.attributes["gen_ai.system"]).toBe("anthropic");

    // pi.chat.calls — one chat, classified "none" (has finish_reason, no error)
    const chatCalls = findMetric(rms, "pi.chat.calls");
    expect(sumPoints(chatCalls)).toHaveLength(1);
    const chatPoint = sumPoints(chatCalls)[0];
    expect(chatPoint?.value).toBe(1);
    expect(chatPoint?.attributes["pi.chat.error_type"]).toBe("none");

    // gen_ai.client.operation.duration — one data point per chat and per tool
    const opDuration = findMetric(rms, "gen_ai.client.operation.duration");
    const opPoints = histogramPoints(opDuration);
    const chatPoints = opPoints.filter(
      (p) => p.attributes["gen_ai.operation.name"] === "chat",
    );
    const toolDurationPoints = opPoints.filter(
      (p) => p.attributes["gen_ai.operation.name"] === "execute_tool",
    );
    expect(chatPoints).toHaveLength(1);
    expect(toolDurationPoints).toHaveLength(1);
  });

  it("records an errored tool call with is_error=true", async () => {
    const { pi, handlers } = createMockPi();
    piOtelExtension(pi as never);

    await fire(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx(),
    );
    await fire(
      handlers,
      "before_agent_start",
      { type: "before_agent_start", prompt: "hi" },
      ctx(),
    );
    await fire(handlers, "turn_start", {
      type: "turn_start",
      turnIndex: 0,
      timestamp: Date.now(),
    });
    await fire(handlers, "tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-err",
      toolName: "bash",
      args: {},
    });
    await fire(handlers, "tool_execution_end", {
      type: "tool_execution_end",
      toolCallId: "call-err",
      toolName: "bash",
      result: {},
      isError: true,
    });
    await fire(handlers, "turn_end", { type: "turn_end", turnIndex: 0 });
    await fire(handlers, "agent_end", { type: "agent_end", messages: [] });

    await provider.forceFlush();
    const rms = exporter.getMetrics();

    const toolCalls = findMetric(rms, "pi.tool.calls");
    const toolPoint = sumPoints(toolCalls)[0];
    expect(toolPoint?.value).toBe(1);
    expect(toolPoint?.attributes["pi.tool.name"]).toBe("bash");
    expect(toolPoint?.attributes["pi.tool.is_error"]).toBe(true);
  });

  it("classifies chat errors: http status, no finish_reason, aborted", async () => {
    const { pi, handlers } = createMockPi();
    piOtelExtension(pi as never);

    await fire(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      ctx(),
    );
    await fire(
      handlers,
      "before_agent_start",
      { type: "before_agent_start", prompt: "hi" },
      ctx(),
    );
    const msg = (over: Record<string, unknown>) => ({
      type: "message_end",
      message: {
        role: "assistant",
        provider: "anthropic",
        model: "claude-opus-4-5",
        ...over,
      },
    });

    // HTTP non-2xx wins over everything else.
    await fire(handlers, "after_provider_response", {
      type: "after_provider_response",
      status: 401,
    });
    await fire(handlers, "message_end", msg({ stopReason: "stop" }));

    // Missing finish_reason.
    await fire(handlers, "message_end", msg({ stopReason: undefined }));

    // Explicit abort.
    await fire(handlers, "message_end", msg({ stopReason: "aborted" }));

    await fire(handlers, "session_shutdown", {
      type: "session_shutdown",
      reason: "quit",
    });
    await provider.forceFlush();
    const rms = exporter.getMetrics();

    const chatCalls = findMetric(rms, "pi.chat.calls");
    const byType = new Map(
      sumPoints(chatCalls).map((p) => [
        p.attributes["pi.chat.error_type"],
        p.value,
      ]),
    );
    expect(byType.get("http_401")).toBe(1);
    expect(byType.get("no_finish_reason")).toBe(1);
    expect(byType.get("aborted")).toBe(1);
    expect(byType.get("none")).toBeUndefined();
  });

  it("ignores non-finite or negative values", async () => {
    const m = new Metrics();
    m.recordTokenUsage("input", "claude", "anthropic", -1);
    m.recordTokenUsage("output", "claude", "anthropic", Number.NaN);
    m.recordOperationDuration("chat", -5);
    m.recordToolDuration("read", -5);
    await provider.forceFlush();
    const rms = exporter.getMetrics();
    expect(findMetric(rms, "gen_ai.client.token.usage")).toBeUndefined();
    expect(findMetric(rms, "gen_ai.client.operation.duration")).toBeUndefined();
    expect(findMetric(rms, "pi.tool.duration")).toBeUndefined();
  });
});
