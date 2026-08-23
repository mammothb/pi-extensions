# @mammothb/pi-otel

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
