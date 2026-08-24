# @mammothb/pi-otel

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
