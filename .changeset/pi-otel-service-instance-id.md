---
"@mammothb/pi-otel": patch
---

Add `service.instance.id` (UUID per extension instance) to OTEL resource attributes. Concurrent `pi` processes on the same host previously shared identical `{service.name, host.name}` labels, so Prometheus/Mimir merged distinct cumulative counters into one series. The resulting sawtooth resets inflated `rate([5m])` dashboard queries (e.g. 896k tokens/min, 69/47 tool calls/min, 259 turns/min while idle) to steady phantom throughput. Each instance now exports a stable UUID — new on `/reload`, `/new`, `/fork`, and `/resume` — so per-instance rates sum correctly and idle correctly shows zero.
