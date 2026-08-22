/**
 * SDK lifecycle for `@mammothb/pi-otel`.
 *
 * Wiring:
 *   `initSdk`   — construct tracer/meter providers + OTLP exporters; not yet
 *                 registered globally. Idempotent: a second call tears down
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
 *
 * Phase 1 covers scaffold + lifecycle only. Spans and metrics recording land
 * in Phases 2 and 3 — those will call `trace.getTracer()` / `metrics.getMeter()`
 * after `startSdk` returns.
 */
import { metrics, trace } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  AggregationTemporality,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * Subset of resolved config that the SDK lifecycle needs at construction.
 * Phase 4's `config.ts` will produce a wider `ResolvedConfig`; this shape is
 * the only part the SDK consumes.
 */
export interface OtelSdkConfig {
  /** Base OTLP HTTP endpoint, e.g. `http://localhost:4318`. Paths
   * `/v1/traces` and `/v1/metrics` are appended. */
  endpoint: string;
  /** Headers attached to every export request (auth, tenant, etc.). */
  headers: Record<string, string>;
  /** Value for the `service.name` resource attribute. */
  serviceName: string;
  /** Additional resource attributes (host.name, user.*, service.*, ...).
   * `service.name` from above is also merged in. Values follow the OTel
   * `AttributeValue` shape. */
  resourceAttributes?: Record<string, string | number | boolean>;
}

/** Public handle to a constructed SDK. */
export interface OtelSdk {
  readonly tracerProvider: BasicTracerProvider;
  readonly meterProvider: MeterProvider;
  readonly traceExporter: OTLPTraceExporter;
  readonly metricReader: PeriodicExportingMetricReader;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

const TRACES_PATH = "/v1/traces";
const METRICS_PATH = "/v1/metrics";
const METRIC_EXPORT_INTERVAL_MS = 60_000;

/** Join a base URL with a path, stripping trailing slashes from the base. */
function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}${path}`;
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

    const traceExporter = new OTLPTraceExporter({
      url: joinUrl(config.endpoint, TRACES_PATH),
      headers: config.headers,
    });

    const metricExporter = new OTLPMetricExporter({
      url: joinUrl(config.endpoint, METRICS_PATH),
      headers: config.headers,
      // CUMULATIVE matches what Prometheus / Mimir expect for counter
      // rate queries; the otel-lgtm stack is Prometheus-backed.
      temporalityPreference: AggregationTemporality.CUMULATIVE,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
    });

    const tracerProvider = new BasicTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(traceExporter)],
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
