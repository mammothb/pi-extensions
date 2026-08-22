/**
 * @mammothb/pi-otel — OpenTelemetry traces + metrics for the pi coding harness.
 *
 * Wiring: lifecycle events from pi drive the SpanTracker and the Metrics
 * recorder. Config is loaded from `pi-otel.json` + env at `session_start`
 * (see `src/config.ts`), which also controls SDK init and content capture.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  BeforeProviderRequestEvent,
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionBeforeForkEvent,
  SessionBeforeTreeEvent,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "@earendil-works/pi-coding-agent";
import { trace } from "@opentelemetry/api";

/**
 * The two event types below are not re-exported from
 * `@earendil-works/pi-coding-agent`'s top-level entry, only from
 * `core/extensions` (which is not in the package's `exports` field). We
 * define the minimal shape we consume to keep the wiring type-safe without
 * deep imports. The shapes match the source `AfterProviderResponseEvent`
 * and `ModelSelectEvent` interfaces.
 */
interface AfterProviderResponseEvent {
  type: "after_provider_response";
  status: number;
  headers: Record<string, string>;
}

interface ModelSelectEvent {
  type: "model_select";
  model: { id: string; provider?: string };
  previousModel: { id: string; provider?: string } | undefined;
  source: string;
}

import { registerOtelCommands } from "./src/commands/otel.js";
import { loadConfig, type ResolvedConfig } from "./src/config.js";
import { Metrics } from "./src/metrics.js";
import {
  initSdk,
  isInitialized,
  type OtelSdk,
  type OtelSdkConfig,
  shutdownSdk,
  startSdk,
} from "./src/sdk.js";
import { SpanTracker } from "./src/spans.js";
import { PI_OTEL_VERSION } from "./src/version.js";

const TRACER_NAME = "@mammothb/pi-otel";

/** Run `git config <key>` and return stdout, or `undefined` on any failure. */
function gitConfig(key: string): string | undefined {
  try {
    const out = execSync(`git config --get ${key}`, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the resource attributes (service.name, host.name, user.*) for the
 * SDK. Order: explicit env > `git config` > hostname fallback.
 */
function buildResourceAttributes(serviceName: string): Record<string, string> {
  const userName =
    process.env.PI_OTEL_USER_NAME ??
    gitConfig("user.name") ??
    process.env.USER ??
    "";
  const userEmail =
    process.env.PI_OTEL_USER_EMAIL ?? gitConfig("user.email") ?? "";
  const attrs: Record<string, string> = {
    "service.name": serviceName,
    "host.name": hostname(),
  };
  if (userName) {
    attrs["user.name"] = userName;
  }
  if (userEmail) {
    attrs["user.email"] = userEmail;
  }
  return attrs;
}

export default function piOtelExtension(pi: ExtensionAPI): void {
  // Per-instance state (factory closure). pi tears down and re-runs the
  // factory on /reload, /new, /fork, and /resume; a fresh closure gives
  // each extension instance clean state.
  const metrics = new Metrics();
  let resolvedConfig: ResolvedConfig | null = null;
  let sdk: OtelSdk | null = null;
  let tracker: SpanTracker | null = null;
  let lastResponseStatus: number | undefined;
  let lastRequestPayload: unknown;
  let chatStartedAt: number | undefined;
  let toolStartedAt: number | undefined;
  let sessionStartedAt: number | undefined;
  // The model the user selected/configured, captured from `model_select`.
  // `message.model` on the response is the *resolved backend* model (e.g. an
  // alias like `hy3-free` routes to `deepseek-v4-pro`), which is the wrong
  // label for `gen_ai.request.model` (\"model asked by the client\").
  let currentModelId: string | undefined;

  registerOtelCommands(pi, {
    getConfig: () => resolvedConfig,
    getSdk: () => sdk,
  });

  // ── SDK lifecycle ─────────────────────────────────────────────────
  pi.on(
    "session_start",
    async (_event: SessionStartEvent, ctx: ExtensionContext) => {
      sessionStartedAt = Date.now();
      resolvedConfig = loadConfig(ctx.cwd);
      if (!resolvedConfig.enabled) {
        return;
      }
      const config: OtelSdkConfig = {
        tracesEndpoint: resolvedConfig.tracesEndpoint,
        metricsEndpoint: resolvedConfig.metricsEndpoint,
        headers: resolvedConfig.headers,
        serviceName: resolvedConfig.serviceName,
        sampleRatio: resolvedConfig.sampleRatio,
        resourceAttributes: buildResourceAttributes(resolvedConfig.serviceName),
      };
      sdk = await initSdk(config);
      startSdk(sdk);
    },
  );

  pi.on("session_shutdown", async (_event: SessionShutdownEvent) => {
    // Session duration is recorded regardless of SDK state — it must not
    // be lost if the exporter is already down.
    if (sessionStartedAt !== undefined) {
      metrics.recordSessionDuration((Date.now() - sessionStartedAt) / 1000);
      sessionStartedAt = undefined;
    }
    if (isInitialized()) {
      tracker?.closeAll();
      tracker = null;
      await shutdownSdk();
      sdk = null;
    }
  });

  // ── session-scoped events on the interaction ───────────────────────
  pi.on("session_compact", (event: SessionCompactEvent) => {
    tracker?.markCompacted();
    tracker?.recordAgentEvent("compaction", {
      reason: event.reason,
      fromExtension: event.fromExtension,
    });
  });

  pi.on("model_select", (event: ModelSelectEvent) => {
    currentModelId = event.model.id;
    tracker?.recordAgentEvent("model_select", {
      from: event.previousModel?.id ?? "",
      to: event.model.id,
      source: event.source,
    });
  });

  pi.on("session_before_fork", (event: SessionBeforeForkEvent) => {
    tracker?.recordAgentEvent("session_before_fork", {
      entryId: event.entryId,
      position: event.position,
    });
  });

  pi.on("session_before_tree", (event: SessionBeforeTreeEvent) => {
    tracker?.recordAgentEvent("session_before_tree", {
      targetId: event.preparation.targetId,
    });
  });

  // ── interaction / turn / chat / tool ──────────────────────────────
  pi.on(
    "before_agent_start",
    (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
      if (!resolvedConfig?.enabled) {
        return;
      }
      // One tracker per interaction. The session id is read from the
      // context here (the resource attributes don't carry it — the tracker
      // sets it as a span attribute on every span).
      const sessionId = ctx.sessionManager.getSessionId();
      const interactionId = randomUUID();
      metrics.recordPrompt();
      tracker = new SpanTracker({
        tracer: trace.getTracer(TRACER_NAME, PI_OTEL_VERSION),
        sessionId,
        interactionId,
        capture: resolvedConfig.capture,
        summaryLength: resolvedConfig.summaryLength,
      });
      tracker.beginInteraction();
      tracker.recordPrompt(event.prompt);
    },
  );

  pi.on("turn_start", (event: TurnStartEvent) => {
    tracker?.beginTurn(event.turnIndex);
  });

  pi.on("turn_end", (_event: TurnEndEvent) => {
    metrics.recordTurn();
    tracker?.endTurn();
  });

  pi.on("before_provider_request", (event: BeforeProviderRequestEvent) => {
    chatStartedAt = Date.now();
    lastRequestPayload = event.payload;
    tracker?.beginChat();
    lastResponseStatus = undefined;
  });

  pi.on("after_provider_response", (event: AfterProviderResponseEvent) => {
    // Cache the HTTP status so the next message_end can attach it.
    lastResponseStatus = event.status;
  });

  pi.on("message_end", (event: MessageEndEvent) => {
    // The assistant message carries model / provider / usage / stop reason.
    const message = event.message as {
      role?: string;
      provider?: string;
      model?: string;
      responseModel?: string;
      stopReason?: string;
      usage?: { input?: number; output?: number };
      errorMessage?: string;
    };
    if (message.role !== "assistant" || !message.provider || !message.model) {
      return;
    }
    // Prefer the client-requested model (from model_select) over the
    // backend-resolved message.model, so gen_ai.request.model reflects the
    // model the user actually selected (e.g. an alias like `hy3-free`).
    const modelLabel = currentModelId ?? message.model ?? "";
    metrics.recordTokenUsage(
      "input",
      modelLabel,
      message.provider ?? "",
      message.usage?.input ?? 0,
    );
    metrics.recordTokenUsage(
      "output",
      modelLabel,
      message.provider ?? "",
      message.usage?.output ?? 0,
    );
    if (chatStartedAt !== undefined) {
      metrics.recordOperationDuration("chat", Date.now() - chatStartedAt);
      chatStartedAt = undefined;
    }
    tracker?.endChat(
      {
        provider: message.provider,
        model: modelLabel,
        responseModel: message.responseModel,
        stopReason: message.stopReason ?? "stop",
        usage: {
          input: message.usage?.input ?? 0,
          output: message.usage?.output ?? 0,
        },
        errorMessage: message.errorMessage,
      },
      lastResponseStatus,
      {
        request: lastRequestPayload,
        response: event.message,
      },
    );
    lastRequestPayload = undefined;
    lastResponseStatus = undefined;
  });

  pi.on("tool_execution_start", (event: ToolExecutionStartEvent) => {
    toolStartedAt = Date.now();
    tracker?.beginTool(event.toolCallId, event.toolName, event.args);
  });

  pi.on("tool_execution_end", (event: ToolExecutionEndEvent) => {
    if (toolStartedAt !== undefined) {
      const toolDurationMs = Date.now() - toolStartedAt;
      metrics.recordOperationDuration("execute_tool", toolDurationMs);
      metrics.recordToolDuration(event.toolName, toolDurationMs);
      toolStartedAt = undefined;
    }
    metrics.recordToolCall(event.toolName, event.isError);
    tracker?.endTool(event.result, event.isError);
  });

  pi.on("agent_end", (_event: AgentEndEvent) => {
    tracker?.endInteraction();
    tracker = null;
  });
}
