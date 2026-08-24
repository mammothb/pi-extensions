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
  PI_CHAT_ERROR_TYPE,
  PI_TOOL_IS_ERROR,
  PI_TOOL_NAME,
} from "./attrs.js";
import { PI_OTEL_VERSION } from "./version.js";

const METER_NAME = "@mammothb/pi-otel";

/** Token-usage series on `gen_ai.client.token.usage`. `cache_read` /
 * `cache_write` are custom `gen_ai.token.type` values (allowed by the
 * semconv when no well-known value applies) covering prompt-cache hits and
 * writes; providers exclude both from the plain `input` count. */
export type TokenType = "input" | "output" | "cache_read" | "cache_write";

/** TokenType → `gen_ai.token.type` attribute value. */
const TOKEN_TYPE_ATTR: Record<TokenType, string> = {
  input: GEN_AI_TOKEN_TYPE_VALUE.INPUT,
  output: GEN_AI_TOKEN_TYPE_VALUE.OUTPUT,
  cache_read: GEN_AI_TOKEN_TYPE_VALUE.CACHE_READ,
  cache_write: GEN_AI_TOKEN_TYPE_VALUE.CACHE_WRITE,
};

/** Explicit histogram buckets. Kept here (rather than relying on the SDK's
 * default [0, 5, 10, 25, ...] exponential) so dashboards get meaningful
 * p50/p95/p99 quantiles out of the box. */
const TOKEN_BUCKETS = [1, 4, 16, 64, 256, 1024, 4096, 16384, 65536];
const DURATION_MS_BUCKETS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
  300000,
];
// Second-scaled copy for the GenAI-semantic `gen_ai.client.operation.duration`.
const DURATION_S_BUCKETS = DURATION_MS_BUCKETS.map((b) => b / 1000);

export class Metrics {
  private _meter: Meter | undefined;
  private _tokenUsage: Histogram | undefined;
  private _opDuration: Histogram | undefined;
  private _promptCount: Counter | undefined;
  private _turnCount: Counter | undefined;
  private _toolCalls: Counter | undefined;
  private _toolDuration: Histogram | undefined;
  private _chatCalls: Counter | undefined;

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
          description:
            "Token usage per LLM call. `input` is the total prompt size (cached tokens included); `cache_read` / `cache_write` are subset breakdowns.",
          unit: "{token}",
          advice: { explicitBucketBoundaries: TOKEN_BUCKETS },
        },
      );
    }
    return this._tokenUsage;
  }

  /** `gen_ai.client.operation.duration` — histogram (seconds), dim
   * `gen_ai.operation.name` (`chat` | `execute_tool`). Follows the GenAI
   * semantic convention (duration in seconds). */
  private opDuration(): Histogram {
    if (!this._opDuration) {
      this._opDuration = this.getMeter().createHistogram(
        "gen_ai.client.operation.duration",
        {
          description: "Duration of LLM chats and tool executions (seconds).",
          unit: "s",
          advice: { explicitBucketBoundaries: DURATION_S_BUCKETS },
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

  /** `pi.tool.duration` — histogram (ms), dim `pi.tool.name`. One observation
   * per tool execution; backs the dashboard's tool-duration heatmap. No unit so
   * Prometheus keeps the bare name `pi_tool_duration_bucket`. */
  private toolDuration(): Histogram {
    if (!this._toolDuration) {
      this._toolDuration = this.getMeter().createHistogram("pi.tool.duration", {
        description: "Tool execution duration in milliseconds.",
        advice: { explicitBucketBoundaries: DURATION_MS_BUCKETS },
      });
    }
    return this._toolDuration;
  }

  // ── recording entry points ───────────────────────────────────────────

  /** Record one token-usage datum for a single chat. See {@link TokenType}
   * for the supported series. */
  recordTokenUsage(
    tokenType: TokenType,
    model: string,
    system: string,
    value: number,
  ): void {
    if (!Number.isFinite(value) || value < 0) {
      return;
    }
    this.tokenUsage().record(value, {
      [GEN_AI_TOKEN_TYPE]: TOKEN_TYPE_ATTR[tokenType],
      [GEN_AI_REQUEST_MODEL]: model,
      [GEN_AI_SYSTEM]: system,
    });
  }

  /** Record the wall-clock duration of one `chat` or `execute_tool`.
   * `durationMs` is converted to seconds before recording to follow the
   * GenAI semantic convention. Negative/NaN values are ignored. */
  recordOperationDuration(
    operation: "chat" | "execute_tool",
    durationMs: number,
  ): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    this.opDuration().record(durationMs / 1000, {
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

  /** `pi.chat.calls` — counter, dim `pi.chat.error_type` (`none`,
   * `http_<status>`, `no_finish_reason`, `aborted`, `error`). */
  private chatCalls(): Counter {
    if (!this._chatCalls) {
      this._chatCalls = this.getMeter().createCounter("pi.chat.calls", {
        description: "Number of LLM chat calls, classified by error type.",
      });
    }
    return this._chatCalls;
  }

  /** Increment the chat-call counter with its error classification. */
  recordChatCall(errorType: string): void {
    this.chatCalls().add(1, {
      [PI_CHAT_ERROR_TYPE]: errorType,
    });
  }

  /** Increment the tool-call counter with its error dimension. */
  recordToolCall(toolName: string, isError: boolean): void {
    this.toolCalls().add(1, {
      [PI_TOOL_NAME]: toolName,
      [PI_TOOL_IS_ERROR]: isError,
    });
  }

  /** Observe the wall-clock duration of one tool execution, in ms. */
  recordToolDuration(toolName: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      return;
    }
    this.toolDuration().record(durationMs, {
      [PI_TOOL_NAME]: toolName,
    });
  }
}
