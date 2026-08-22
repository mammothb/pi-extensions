/**
 * Config resolution for `@mammothb/pi-otel`.
 *
 * Loaded from JSON config files via the shared loader (`@mammothb/pi-shared`):
 *
 *   - global: `~/.pi/agent/pi-otel.json`
 *   - project: `<cwd>/.pi/pi-otel.json` (wins per-key)
 *
 * Then `OTEL_*` env vars, then `PI_OTEL_*` env vars (highest). Precedence
 * applied to the flat config file:
 *
 *   `PI_OTEL_*` > `OTEL_*` > `pi-otel.json` > defaults
 */
import { loadPiConfig, resolveSecrets } from "@mammothb/pi-shared";

export interface CaptureConfig {
  /** Emit prompt text as a span event attribute. */
  prompts: boolean;
  /** Emit tool arguments (truncated). */
  toolArgs: boolean;
  /** Emit tool result text (truncated). */
  toolResults: boolean;
  /** Emit serialized provider request/response bodies (truncated). */
  providerPayloads: boolean;
}

export interface ResolvedConfig {
  /** Master switch. When false, the extension does not start the SDK. */
  enabled: boolean;
  /** Base OTLP endpoint (e.g. `http://localhost:4318`). */
  endpoint: string;
  /** Fully-resolved traces endpoint (`…/v1/traces` or an explicit override). */
  tracesEndpoint: string;
  /** Fully-resolved metrics endpoint (`…/v1/metrics` or an explicit override). */
  metricsEndpoint: string;
  /** Headers attached to every export request. */
  headers: Record<string, string>;
  /** `service.name` resource attribute. */
  serviceName: string;
  /** Trace sampling ratio, 0.0–1.0. */
  sampleRatio: number;
  /** Max chars of captured content before truncation. */
  summaryLength: number;
  capture: CaptureConfig;
}

const TRACES_PATH = "/v1/traces";
const METRICS_PATH = "/v1/metrics";

export const DEFAULT_ENDPOINT = "http://localhost:4318";
export const DEFAULT_SERVICE_NAME = "pi";
export const DEFAULT_SUMMARY_LENGTH = 512;

export const DEFAULT_CAPTURE: CaptureConfig = {
  prompts: false,
  toolArgs: false,
  toolResults: false,
  providerPayloads: false,
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  enabled: true,
  endpoint: DEFAULT_ENDPOINT,
  tracesEndpoint: `${DEFAULT_ENDPOINT}${TRACES_PATH}`,
  metricsEndpoint: `${DEFAULT_ENDPOINT}${METRICS_PATH}`,
  headers: {},
  serviceName: DEFAULT_SERVICE_NAME,
  sampleRatio: 1.0,
  summaryLength: DEFAULT_SUMMARY_LENGTH,
  capture: { ...DEFAULT_CAPTURE },
};

// ── env var names ─────────────────────────────────────────────────────────

const ENV = {
  OTEL_ENDPOINT: "OTEL_EXPORTER_OTLP_ENDPOINT",
  OTEL_TRACES_ENDPOINT: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  OTEL_METRICS_ENDPOINT: "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  OTEL_HEADERS: "OTEL_EXPORTER_OTLP_HEADERS",
  OTEL_SERVICE_NAME: "OTEL_SERVICE_NAME",
  PI_OTEL_ENABLED: "PI_OTEL_ENABLED",
  PI_OTEL_CAPTURE_PROMPTS: "PI_OTEL_CAPTURE_PROMPTS",
  PI_OTEL_CAPTURE_TOOL_ARGS: "PI_OTEL_CAPTURE_TOOL_ARGS",
  PI_OTEL_CAPTURE_TOOL_RESULTS: "PI_OTEL_CAPTURE_TOOL_RESULTS",
  PI_OTEL_CAPTURE_PROVIDER_PAYLOADS: "PI_OTEL_CAPTURE_PROVIDER_PAYLOADS",
} as const;

/** Parse a boolean-ish env value. Returns undefined when absent or unparseable. */
function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") {
    return true;
  }
  if (v === "false" || v === "0" || v === "no" || v === "off") {
    return false;
  }
  return undefined;
}

/** Parse `OTEL_EXPORTER_OTLP_HEADERS` (`key=value,key2=value2`) into a
 * record. Values may contain `=`; split on the first `=`. Malformed pairs
 * are skipped. */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      continue; // no key, or empty key
    }
    const key = pair.slice(0, eq).trim();
    const rawValue = pair.slice(eq + 1).trim();
    // Percent-decode the value (%20 -> space, %2C -> comma, ...). Malformed
    // sequences are kept as-is rather than throwing.
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // leave value as the undecoded rawValue
    }
    if (key) {
      headers[key] = value;
    }
  }
  return headers;
}

/** Trim trailing slashes from a URL. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Merge a `pi-otel.json` object into the base config. Type-checked per
 * field; unknown or wrong-typed fields are ignored. Returns a new object
 * and never mutates `base` (required by `loadPiConfig`).
 */
export function mergeConfig(
  base: ResolvedConfig,
  overrides: Record<string, unknown>,
): ResolvedConfig {
  const merged: ResolvedConfig = {
    ...base,
    capture: mergeCapture(base.capture, overrides.capture),
  };

  if (typeof overrides.enabled === "boolean") {
    merged.enabled = overrides.enabled;
  }
  if (typeof overrides.endpoint === "string") {
    merged.endpoint = overrides.endpoint;
  }
  if (
    overrides.headers !== null &&
    typeof overrides.headers === "object" &&
    !Array.isArray(overrides.headers)
  ) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(overrides.headers)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
    merged.headers = headers;
  }
  if (typeof overrides.serviceName === "string") {
    merged.serviceName = overrides.serviceName;
  }
  if (
    typeof overrides.sampleRatio === "number" &&
    Number.isFinite(overrides.sampleRatio) &&
    overrides.sampleRatio >= 0 &&
    overrides.sampleRatio <= 1
  ) {
    merged.sampleRatio = overrides.sampleRatio;
  }
  if (
    typeof overrides.summaryLength === "number" &&
    Number.isFinite(overrides.summaryLength) &&
    overrides.summaryLength >= 0
  ) {
    merged.summaryLength = overrides.summaryLength;
  }

  return merged;
}

/** Merge the `capture` block of a `pi-otel.json` object over a base. Wrong-
 * typed or absent fields are ignored. Returns a new object. */
function mergeCapture(base: CaptureConfig, capture: unknown): CaptureConfig {
  if (
    capture === null ||
    typeof capture !== "object" ||
    Array.isArray(capture)
  ) {
    return { ...base };
  }
  const c = capture as Record<string, unknown>;
  const result: CaptureConfig = { ...base };
  if (typeof c.prompts === "boolean") {
    result.prompts = c.prompts;
  }
  if (typeof c.toolArgs === "boolean") {
    result.toolArgs = c.toolArgs;
  }
  if (typeof c.toolResults === "boolean") {
    result.toolResults = c.toolResults;
  }
  if (typeof c.providerPayloads === "boolean") {
    result.providerPayloads = c.providerPayloads;
  }
  return result;
}

/**
 * Apply `OTEL_*` then `PI_OTEL_*` env vars on top of a config, and resolve
 * the per-signal endpoints. Returns a new object; never mutates `base`.
 */
export function applyEnv(
  base: ResolvedConfig,
  env: NodeJS.ProcessEnv,
): ResolvedConfig {
  const otelEndpoint = env[ENV.OTEL_ENDPOINT];
  const otelTracesEndpoint = env[ENV.OTEL_TRACES_ENDPOINT];
  const otelMetricsEndpoint = env[ENV.OTEL_METRICS_ENDPOINT];
  const otelHeaders = env[ENV.OTEL_HEADERS];
  const otelServiceName = env[ENV.OTEL_SERVICE_NAME];

  const endpoint = otelEndpoint ?? base.endpoint;
  const headers = otelHeaders
    ? { ...base.headers, ...parseHeaders(otelHeaders) }
    : base.headers;
  const serviceName = otelServiceName ?? base.serviceName;
  const enabled = parseBool(env[ENV.PI_OTEL_ENABLED]) ?? base.enabled;
  const capture: CaptureConfig = {
    prompts:
      parseBool(env[ENV.PI_OTEL_CAPTURE_PROMPTS]) ?? base.capture.prompts,
    toolArgs:
      parseBool(env[ENV.PI_OTEL_CAPTURE_TOOL_ARGS]) ?? base.capture.toolArgs,
    toolResults:
      parseBool(env[ENV.PI_OTEL_CAPTURE_TOOL_RESULTS]) ??
      base.capture.toolResults,
    providerPayloads:
      parseBool(env[ENV.PI_OTEL_CAPTURE_PROVIDER_PAYLOADS]) ??
      base.capture.providerPayloads,
  };

  // Per-signal endpoints: an explicit `…_TRACES_ENDPOINT` / `…_METRICS_ENDPOINT`
  // wins and is used as-is (no path appended); otherwise the base gets the
  // signal path appended.
  const tracesEndpoint =
    otelTracesEndpoint ?? `${trimTrailingSlash(endpoint)}${TRACES_PATH}`;
  const metricsEndpoint =
    otelMetricsEndpoint ?? `${trimTrailingSlash(endpoint)}${METRICS_PATH}`;

  return {
    enabled,
    endpoint,
    tracesEndpoint,
    metricsEndpoint,
    headers,
    serviceName,
    sampleRatio: base.sampleRatio,
    summaryLength: base.summaryLength,
    capture,
  };
}

/**
 * Load the fully-resolved config: `pi-otel.json` (global + project, via
 * `@mammothb/pi-shared`), then env overrides.
 */
export function loadConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const fileConfig = loadPiConfig(
    "pi-otel.json",
    cwd,
    DEFAULT_CONFIG,
    mergeConfig,
  );
  const resolved = applyEnv(fileConfig, env);
  // Resolve `env:` / `file:` indirection in header values so secrets can
  // live outside the committed config file.
  return {
    ...resolved,
    headers: resolveSecrets(resolved.headers),
  };
}
