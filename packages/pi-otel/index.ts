/**
 * @mammothb/pi-otel — OpenTelemetry traces + metrics for the pi coding harness.
 *
 * Phase 2+3 wiring: lifecycle events from pi drive the SpanTracker and the
 * Metrics recorder. The SDK lifecycle (init on `session_start`, shutdown on
 * `session_shutdown`) and resource attributes are also handled here. Config
 * resolution lands in Phase 4 — for now minimal defaults keep the wiring
 * testable.
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

import { Metrics } from "./src/metrics.js";
import {
  initSdk,
  isInitialized,
  type OtelSdkConfig,
  shutdownSdk,
  startSdk,
} from "./src/sdk.js";
import { SpanTracker } from "./src/spans.js";
import { PI_OTEL_VERSION } from "./src/version.js";

const TRACER_NAME = "@mammothb/pi-otel";

/** Phase 2/3 default config; replaced by `config.ts` resolution in Phase 4. */
const DEFAULT_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const DEFAULT_SERVICE_NAME = "pi";

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
 * SDK. Order: explicit env > `git config` > hostname fallback. `user.*`
 * env vars follow the `PI_OTEL_USER_*` convention; Phase 4 will also read
 * `OTEL_RESOURCE_ATTRIBUTES`.
 */
function buildResourceAttributes(): Record<string, string> {
  const userName =
    process.env.PI_OTEL_USER_NAME ??
    gitConfig("user.name") ??
    process.env.USER ??
    "";
  const userEmail =
    process.env.PI_OTEL_USER_EMAIL ?? gitConfig("user.email") ?? "";
  const attrs: Record<string, string> = {
    "service.name": DEFAULT_SERVICE_NAME,
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
  let tracker: SpanTracker | null = null;
  let lastResponseStatus: number | undefined;
  let chatStartedAt: number | undefined;
  let toolStartedAt: number | undefined;
  let sessionStartedAt: number | undefined;

  // ── SDK lifecycle ─────────────────────────────────────────────────
  pi.on(
    "session_start",
    async (_event: SessionStartEvent, ctx: ExtensionContext) => {
      sessionStartedAt = Date.now();
      // Re-init on every session_start. The SDK's initOnce guard tears down
      // any prior SDK first, so this is safe across `/new`, `/reload`,
      // `/resume`, and `/fork`.
      const config: OtelSdkConfig = {
        endpoint: DEFAULT_ENDPOINT,
        headers: {},
        serviceName: DEFAULT_SERVICE_NAME,
        resourceAttributes: buildResourceAttributes(),
      };
      const sdk = await initSdk(config);
      startSdk(sdk);
      void ctx; // session id is read per-event from the ExtensionContext
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
      // One tracker per interaction. The session id is read from the
      // context here (the resource attributes don't carry it — the tracker
      // sets it as a span attribute on every span).
      const sessionId = ctx.sessionManager.getSessionId();
      const interactionId = randomUUID();
      void event; // prompt/image are not used until Phase 4 capture
      metrics.recordPrompt();
      tracker = new SpanTracker({
        tracer: trace.getTracer(TRACER_NAME, PI_OTEL_VERSION),
        sessionId,
        interactionId,
      });
      tracker.beginInteraction();
    },
  );

  pi.on("turn_start", (event: TurnStartEvent) => {
    tracker?.beginTurn(event.turnIndex);
  });

  pi.on("turn_end", (_event: TurnEndEvent) => {
    metrics.recordTurn();
    tracker?.endTurn();
  });

  pi.on("before_provider_request", (_event: BeforeProviderRequestEvent) => {
    chatStartedAt = Date.now();
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
    metrics.recordTokenUsage(
      "input",
      message.model,
      message.provider,
      message.usage?.input ?? 0,
    );
    metrics.recordTokenUsage(
      "output",
      message.model,
      message.provider,
      message.usage?.output ?? 0,
    );
    if (chatStartedAt !== undefined) {
      metrics.recordOperationDuration("chat", Date.now() - chatStartedAt);
      chatStartedAt = undefined;
    }
    tracker?.endChat(
      {
        provider: message.provider,
        model: message.model,
        responseModel: message.responseModel,
        stopReason: message.stopReason ?? "stop",
        usage: {
          input: message.usage?.input ?? 0,
          output: message.usage?.output ?? 0,
        },
        errorMessage: message.errorMessage,
      },
      lastResponseStatus,
    );
    lastResponseStatus = undefined;
  });

  pi.on("tool_execution_start", (event: ToolExecutionStartEvent) => {
    toolStartedAt = Date.now();
    // Placeholder hashes until Phase 4's content.ts supplies the real
    // sha256 of args/result.
    tracker?.beginTool(event.toolCallId, event.toolName, "");
  });

  pi.on("tool_execution_end", (event: ToolExecutionEndEvent) => {
    if (toolStartedAt !== undefined) {
      metrics.recordOperationDuration(
        "execute_tool",
        Date.now() - toolStartedAt,
      );
      toolStartedAt = undefined;
    }
    metrics.recordToolCall(event.toolName, event.isError);
    tracker?.endTool("", event.isError);
    void event.result; // Phase 4 will hash the result and pass it through
  });

  pi.on("agent_end", (_event: AgentEndEvent) => {
    tracker?.endInteraction();
    tracker = null;
  });
}
