# @mammothb/pi-otel

## 0.2.2

### Patch Changes

- b50bd7a: Polish the sample Grafana dashboard and the local otel-lgtm stack:

  - Tool execution duration (distribution): fixed-color overrides per bucket
    (`0-10ms` green, `10-100ms` blue, `100ms-1s` yellow, `1-10s` orange,
    `>10s` red) instead of the default palette.
  - Activity row: the three panels are now evenly sized (`w=8` each, `x=0/8/16`)
    filling the 24-wide row.
  - Tool call distribution, Tool calls by name, Tool error rate, and Tool
    execution duration: queries switched from fixed windows (`[1h]` / `[5m]`)
    and raw counters to `$__range`-scoped `increase()` / `rate()`, plus a
    `> 0` filter so tools with no activity in the selected range no longer
    appear with `none` / `0%` entries.
  - otel-lgtm compose: set `GF_DASHBOARDS_DASHBOARDS_ALLOW_UI_UPDATES=true`
    so the bundled OTel dashboards (JVM Overview, RED Metrics ×2) can be
    deleted from the UI.

## 0.2.1

### Patch Changes

- Updated dependencies [0152f03]
  - @mammothb/pi-shared@1.6.0

## 0.2.0

### Minor Changes

- 1db8c7e: Record prompt-cache tokens and make `input` the inclusive prompt size.

  Providers report cached tokens separately from the uncached remainder
  (Anthropic `cache_read_input_tokens` / `cache_creation_input_tokens`, Bedrock
  Converse `cacheReadInputTokens` / `cacheWriteInputTokens`), and pi-ai
  normalizes `usage.input` to that remainder on every backend. For Claude models
  — where pi's provider layer places a cache breakpoint at the end of the prompt
  — the remainder is near zero on every call, so `gen_ai.token.type=input` used
  to record ~0 tokens while output showed thousands.

  Per the semconv ("cached tokens SHOULD be included in
  `gen_ai.usage.input_tokens`"), both chat-span attribute
  `gen_ai.usage.input_tokens` and the metric's `input` series now carry the full
  prompt size (`uncached + cache reads + writes`). Cached tokens additionally
  get their own breakdown series/attributes using the canonical names:
  `gen_ai.usage.cache_read.input_tokens` and
  `gen_ai.usage.cache_creation.input_tokens` (metric token types `cache_read` /
  `cache_write`; zero-valued caches skipped). Because caches are subsets of
  `input`, don't sum the token-type series; uncached-only =
  `input − cache_read − cache_write`.

## 0.1.2

### Patch Changes

- fbf4143: Add `service.instance.id` (UUID per extension instance) to OTEL resource attributes. Concurrent `pi` processes on the same host previously shared identical `{service.name, host.name}` labels, so Prometheus/Mimir merged distinct cumulative counters into one series. The resulting sawtooth resets inflated `rate([5m])` dashboard queries (e.g. 896k tokens/min, 69/47 tool calls/min, 259 turns/min while idle) to steady phantom throughput. Each instance now exports a stable UUID — new on `/reload`, `/new`, `/fork`, and `/resume` — so per-instance rates sum correctly and idle correctly shows zero.

## 0.1.1

### Patch Changes

- Updated dependencies [ab5640c]
  - @mammothb/pi-shared@1.5.0

## 0.1.0

### Minor Changes

- 67635f8: Initial release: OTel traces + metrics for pi, OTLP/HTTP export,
  hybrid gen*ai.* + pi.\_ semantics, session-as-attribute model,
  metadata-only default with granular capture flags, /otel-status
  and /otel-flush commands, Grafana dashboard, and a local
  otel-lgtm docker-compose for development.

## 0.1.0
