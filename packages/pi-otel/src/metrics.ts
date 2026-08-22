/**
 * Client-side metric recorder for `@mammothb/pi-otel`.
 *
 * All instruments are created lazily on first use. The `Meter` is fetched
 * from the OTel global meter provider on the first `record*` call, which is
 * why this class can be constructed before `startSdk()` has run — as long as
 * no metric is recorded until after `session_start` registers the provider.
 *
 * Lazy construction also means a second extension reload (new `Metrics`
 * instance) re-resolves the same instrument names from the provider; the OTel
 * meter dedups instruments by name+kind+unit, so nothing is double-registered.
 */
import {
  type Counter,
  type Histogram,
  type Meter,
  metrics,
} from "@opentelemetry/api";
import {
  GEN_AI_OPERATION_NAME,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_SYSTEM,
  GEN_AI_TOKEN_TYPE,
  GEN_AI_TOKEN_TYPE_VALUE,
  PI_TOOL_IS_ERROR,
  PI_TOOL_NAME,
} from "./attrs.js";
import { PI_OTEL_VERSION } from "./version.js";

const METER_NAME = "@mammothb/pi-otel";

/** Explicit histogram buckets. Kept here (rather than relying on the SDK's
 * default [0, 5, 10, 25, ...] exponential) so dashboards get meaningful
 * p50/p95/p99 quantiles out of the box. */
const TOKEN_BUCKETS = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536];
const DURATION_MS_BUCKETS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
  300000,
];
const DURATION_S_BUCKETS = [
  60, 300, 600, 1800, 3600, 7200, 14400, 28800, 86400,
];

export class Metrics {
  private _meter: Meter | undefined;
  private _tokenUsage: Histogram | undefined;
  private _opDuration: Histogram | undefined;
  private _promptCount: Counter | undefined;
  private _turnCount: Counter | undefined;
  private _toolCalls: Counter | undefined;
  private _sessionDuration: Histogram | undefined;

  /** Fetch (and cache) the meter lazily. */
  private getMeter(): Meter {
    if (!this._meter) {
      this._meter = metrics.getMeter(METER_NAME, PI_OTEL_VERSION);
    }
    return this._meter;
  }

  /** `gen_ai.client.token.usage` — histogram, dims
   * `gen_ai.token.type × gen_ai.request.model × gen_ai.system`. */
  private tokenUsage(): Histogram {
    if (!this._tokenUsage) {
      this._tokenUsage = this.getMeter().createHistogram(
        "gen_ai.client.token.usage",
        {
          description: "Token usage per LLM call, split by input/output.",
          unit: "{token}",
          advice: { explicitBucketBoundaries: TOKEN_BUCKETS },
        },
      );
    }
    return this._tokenUsage;
  }

  /** `gen_ai.client.operation.duration` — histogram (ms), dim
   * `gen_ai.operation.name` (`chat` | `execute_tool`). */
  private opDuration(): Histogram {
    if (!this._opDuration) {
      this._opDuration = this.getMeter().createHistogram(
        "gen_ai.client.operation.duration",
        {
          description: "Duration of LLM chats and tool executions.",
          unit: "ms",
          advice: { explicitBucketBoundaries: DURATION_MS_BUCKETS },
        },
      );
    }
    return this._opDuration;
  }

  /** `pi.prompt.count` — counter. One increment per user prompt. */
  private promptCount(): Counter {
    if (!this._promptCount) {
      this._promptCount = this.getMeter().createCounter("pi.prompt.count", {
        description: "Number of user prompts (interactions) processed.",
      });
    }
    return this._promptCount;
  }

  /** `pi.turn.count` — counter. One increment per agent turn. */
  private turnCount(): Counter {
    if (!this._turnCount) {
      this._turnCount = this.getMeter().createCounter("pi.turn.count", {
        description: "Number of agent turns.",
      });
    }
    return this._turnCount;
  }

  /** `pi.tool.calls` — counter, dims `pi.tool.name × pi.tool.is_error`. */
  private toolCalls(): Counter {
    if (!this._toolCalls) {
      this._toolCalls = this.getMeter().createCounter("pi.tool.calls", {
        description: "Number of tool executions.",
      });
    }
    return this._toolCalls;
  }

  /** `pi.session.duration` — histogram (s). One observation per session. */
  private sessionDuration(): Histogram {
    if (!this._sessionDuration) {
      this._sessionDuration = this.getMeter().createHistogram(
        "pi.session.duration",
        {
          description: "Session wall-clock duration in seconds.",
          unit: "s",
          advice: { explicitBucketBoundaries: DURATION_S_BUCKETS },
        },
      );
    }
    return this._sessionDuration;
  }

  // ── recording entry points ───────────────────────────────────────────

  /** Record one token-usage datum for a single chat. `tokenType` is
   * `input` or `output`. */
  recordTokenUsage(
    tokenType: "input" | "output",
    model: string,
    system: string,
    value: number,
  ): void {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    this.tokenUsage().record(value, {
      [GEN_AI_TOKEN_TYPE]:
        tokenType === "input"
          ? GEN_AI_TOKEN_TYPE_VALUE.INPUT
          : GEN_AI_TOKEN_TYPE_VALUE.OUTPUT,
      [GEN_AI_REQUEST_MODEL]: model,
      [GEN_AI_SYSTEM]: system,
    });
  }

  /** Record the wall-clock duration of one `chat` or `execute_tool`. */
  recordOperationDuration(
    operation: "chat" | "execute_tool",
    durationMs: number,
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    this.opDuration().record(durationMs, {
      [GEN_AI_OPERATION_NAME]: operation,
    });
  }

  /** Increment the prompt counter. */
  recordPrompt(): void {
    this.promptCount().add(1);
  }

  /** Increment the turn counter. */
  recordTurn(): void {
    this.turnCount().add(1);
  }

  /** Increment the tool-call counter with its error dimension. */
  recordToolCall(toolName: string, isError: boolean): void {
    this.toolCalls().add(1, {
      [PI_TOOL_NAME]: toolName,
      [PI_TOOL_IS_ERROR]: isError,
    });
  }

  /** Observe the session duration in seconds. */
  recordSessionDuration(durationSec: number): void {
    if (!Number.isFinite(durationSec) || durationSec < 0) {
      return;
    }
    this.sessionDuration().record(durationSec);
  }
}
