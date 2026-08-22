/**
 * SDK lifecycle for `@mammothb/pi-otel`.
 *
 * Wiring:
 *   `initSdk`   — construct tracer/meter providers + OTLP exporters, without
 *                 registering them globally. Idempotent: a second call tears down
 *                 any prior SDK first, so `/reload` and session-switch don't
 *                 leak a dead provider.
 *   `startSdk`  — register the providers on the OTel global API. After this,
 *                 `trace.getTracer()` and `metrics.getMeter()` return handles
 *                 backed by our exporters.
 *   `shutdownSdk` — flush + close all exporters, then call `trace.disable()`
 *                   and `metrics.disable()` so the globals are clear for the
 *                   next session.
 *
 * Why manual wiring instead of `@opentelemetry/sdk-node`?
 *   - One fewer experimental dependency.
 *   - Explicit control over the `initOnce` guard and the disable-before-set
 *     pattern the OTel API requires (it refuses to replace a registered
 *     provider without `disable()` first).
 *   - Resource attributes and headers are config-driven, not env-only.
 */
import { metrics, trace } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BasicTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";

/**
 * Subset of resolved config that the SDK lifecycle needs at construction.
 * `config.ts` produces a wider `ResolvedConfig`; this shape is the only part
 * the SDK consumes.
 */
export interface OtelSdkConfig {
  /** Fully-resolved traces endpoint (already includes `/v1/traces`). */
  tracesEndpoint: string;
  /** Fully-resolved metrics endpoint (already includes `/v1/metrics`). */
  metricsEndpoint: string;
  /** Headers attached to every export request (auth, tenant, etc.). */
  headers: Record<string, string>;
  /** Value for the `service.name` resource attribute. */
  serviceName: string;
  /** Trace sampling ratio, 0.0–1.0 (default 1.0). */
  sampleRatio?: number;
  /** Additional resource attributes (host.name, user.*, service.*, ...).
   * `service.name` from above is also merged in. Values follow the OTel
   * `AttributeValue` shape. */
  resourceAttributes?: Record<string, string | number | boolean>;
}

/** Cumulative export stats, surfaced by `/otel-status`. */
export interface OtelExportStats {
  /** Spans handed to the trace exporter. */
  exportedSpans: number;
  /** Metric data points handed to the metric exporter. */
  exportedDataPoints: number;
  /** Message of the most recent export failure, if any. */
  lastError?: string;
}

/** Public handle to a constructed SDK. */
export interface OtelSdk {
  readonly tracerProvider: BasicTracerProvider;
  readonly meterProvider: MeterProvider;
  readonly traceExporter: OTLPTraceExporter;
  readonly metricReader: PeriodicExportingMetricReader;
  /** Snapshot of cumulative export stats. */
  getStats(): OtelExportStats;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

const METRIC_EXPORT_INTERVAL_MS = 10_000;

/** Clamp a sampling ratio to [0, 1]. */
function clampRatio(ratio: number): number {
  return Math.min(1, Math.max(0, ratio));
}

/** Count the total number of metric data points in one collection. */
function countDataPoints(rm: ResourceMetrics): number {
  let count = 0;
  for (const sm of rm.scopeMetrics) {
    for (const metric of sm.metrics) {
      count += metric.dataPoints.length;
    }
  }
  return count;
}

/** Wrap the trace exporter to count spans + record failures. */
function wrapTraceExporter(
  inner: OTLPTraceExporter,
  stats: OtelExportStats,
): SpanExporter {
  return {
    export(spans, resultCallback) {
      stats.exportedSpans += spans.length;
      inner.export(spans, (result) => {
        if (result.error) {
          stats.lastError = result.error.message;
        }
        resultCallback(result);
      });
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush(),
  };
}

/** Wrap the metric exporter to count data points + record failures. */
function wrapMetricExporter(
  inner: OTLPMetricExporter,
  stats: OtelExportStats,
): PushMetricExporter {
  return {
    export(metrics, resultCallback) {
      stats.exportedDataPoints += countDataPoints(metrics);
      inner.export(metrics, (result) => {
        if (result.error) {
          stats.lastError = result.error.message;
        }
        resultCallback(result);
      });
    },
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
    selectAggregationTemporality: (t) => inner.selectAggregationTemporality(t),
    selectAggregation: (t) => inner.selectAggregation(t),
  };
}

let active: OtelSdk | null = null;
let inflight: Promise<OtelSdk> | null = null;

/**
 * Build a fresh SDK. Tears down any prior SDK first so the OTel global API
 * can accept the new providers (it refuses to replace a registered one
 * without `disable()` first). Concurrent calls share a single in-flight
 * promise to avoid double-init.
 */
export async function initSdk(config: OtelSdkConfig): Promise<OtelSdk> {
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    if (active) {
      await shutdownActive();
    }

    const resource = resourceFromAttributes({
      "service.name": config.serviceName,
      ...(config.resourceAttributes ?? {}),
    });

    const stats: OtelExportStats = {
      exportedSpans: 0,
      exportedDataPoints: 0,
    };

    const traceExporter = new OTLPTraceExporter({
      url: config.tracesEndpoint,
      headers: config.headers,
    });

    const metricExporter = new OTLPMetricExporter({
      url: config.metricsEndpoint,
      headers: config.headers,
      // CUMULATIVE matches what Prometheus / Mimir expect for counter
      // rate queries; the otel-lgtm stack is Prometheus-backed.
      temporalityPreference: AggregationTemporality.CUMULATIVE,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: wrapMetricExporter(metricExporter, stats),
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
    });

    const sampleRatio = clampRatio(config.sampleRatio ?? 1.0);
    const tracerProvider = new BasicTracerProvider({
      resource,
      sampler:
        sampleRatio >= 1
          ? new AlwaysOnSampler()
          : sampleRatio <= 0
            ? new AlwaysOffSampler()
            : new ParentBasedSampler({
                root: new TraceIdRatioBasedSampler(sampleRatio),
              }),
      spanProcessors: [
        new BatchSpanProcessor(wrapTraceExporter(traceExporter, stats)),
      ],
    });

    const meterProvider = new MeterProvider({
      resource,
      readers: [metricReader],
    });

    const sdk: OtelSdk = {
      tracerProvider,
      meterProvider,
      traceExporter,
      metricReader,
      getStats() {
        return { ...stats };
      },
      async forceFlush() {
        await Promise.allSettled([
          tracerProvider.forceFlush(),
          meterProvider.forceFlush(),
        ]);
      },
      async shutdown() {
        await Promise.allSettled([
          tracerProvider.shutdown(),
          meterProvider.shutdown(),
        ]);
      },
    };

    active = sdk;
    return sdk;
  })();
  return inflight;
}

/** Register the SDK's providers as the OTel global providers. */
export function startSdk(sdk: OtelSdk): void {
  trace.setGlobalTracerProvider(sdk.tracerProvider);
  metrics.setGlobalMeterProvider(sdk.meterProvider);
}

/** Shut down the active SDK and clear the OTel globals. No-op if not active. */
export async function shutdownSdk(): Promise<void> {
  if (inflight) {
    try {
      await inflight;
    } catch {
      // init failure: nothing to shut down
    }
  }
  await shutdownActive();
  // Always clear globals, even if there was no active SDK, so a stale
  // provider from a prior session can't keep a dead exporter alive.
  trace.disable();
  metrics.disable();
}

async function shutdownActive(): Promise<void> {
  const sdk = active;
  active = null;
  inflight = null;
  if (!sdk) {
    return;
  }
  try {
    await sdk.shutdown();
  } catch {
    // best effort — exporter may already be torn down by the runtime
  }
}

/** True when an SDK has been constructed and is live. */
export function isInitialized(): boolean {
  return active !== null;
}
