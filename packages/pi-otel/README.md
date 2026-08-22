# @mammothb/pi-otel

OpenTelemetry observability for the pi coding harness. Exports **traces +
metrics** over **OTLP/HTTP** to a Grafana **otel-lgtm** stack (Loki + Grafana +
Tempo + Mimir). Hybrid semantics: `gen_ai.*` for LLM/tool spans, `pi.*` for
harness concepts the semconv doesn't cover.

Answers, against a deployed otel-lgtm stack: *what did this session do, which
tools were slow, where did tokens go, what did a turn cost, and did any tool
fail?* — without leaking prompt content by default.

## Install

```sh
pnpm add @mammothb/pi-otel
```

Enable it in pi's extension list (settings, or `pi.extensions`). Ships TS
source directly — no build step.

## Configuration

Zero-config works against `http://localhost:4318` with content capture off.
To change anything, drop a `pi-otel.json` file:

```jsonc
// ~/.pi/agent/pi-otel.json (global) or <cwd>/.pi/pi-otel.json (project, wins per-key)
{
  "enabled": true,
  "endpoint": "http://localhost:4318",   // base; /v1/traces + /v1/metrics appended
  "headers": {},
  "serviceName": "pi",
  "sampleRatio": 1.0,
  "capture": { "prompts": false, "toolArgs": false, "toolResults": false, "providerPayloads": false },
  "summaryLength": 512
}
```

Loaded through `@mammothb/pi-shared`'s `loadPiConfig` — the same loader every
other `@mammothb/` extension uses.

### Secrets in headers

Header values support `env:` / `file:` indirection, so API keys can live
outside the (often committed) config file:

```jsonc
{ "headers": { "X-API-Key": "file:~/.pi/secrets/otel-api-key" } }
// or:        { "X-API-Key": "env:PI_OTEL_API_KEY" }
```

- `env:VAR_NAME` — read the value from an environment variable
- `file:/path` — read the value from a file (a leading `~` is expanded; contents are trimmed)
- anything else — used literally

A missing file / env var falls back to the literal string (visible in the
header, rather than a silently empty secret). Resolution happens at config
load time via `@mammothb/pi-shared`'s `resolveSecrets`.

### Env vars

| Var | Purpose |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | base endpoint |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | traces endpoint (full URL, wins over base) |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | metrics endpoint (full URL, wins over base) |
| `OTEL_EXPORTER_OTLP_HEADERS` | `key=value,key2=value2` |
| `OTEL_SERVICE_NAME` | `service.name` resource attribute |
| `PI_OTEL_ENABLED` | master switch (`true`/`false`) |
| `PI_OTEL_CAPTURE_PROMPTS` / `_TOOL_ARGS` / `_TOOL_RESULTS` / `_PROVIDER_PAYLOADS` | capture overrides |

Precedence: `PI_OTEL_*` > `OTEL_*` > `pi-otel.json` > defaults.

### Content capture

Default is metadata-only: sha256 hashes, counts, durations, token usage, model
names. Each `capture.*` flag independently opts into raw content, truncated to
`summaryLength`:

- `capture.prompts` — prompt text as a span event
- `capture.toolArgs` / `capture.toolResults` — tool I/O
- `capture.providerPayloads` — serialized provider request/response bodies

Hashes stay on regardless, so spans remain correlatable without leaking content.

## Commands

- `/otel-status` — resolved config, endpoints, capture modes, exported span /
  data-point counts, last export error.
- `/otel-flush` — force-flush pending spans + metrics.

## Grafana dashboard

Import `dashboards/pi-otel.json` into Grafana. Panels: token rate by model,
operation duration p95, chat error rate, tool-call distribution + rate +
error rate, tool-duration distribution, prompt/turn rate, and a traces table
linking to Tempo.

## Local dev stack

```sh
cd samples/otel-lgtm
docker compose up -d
# Grafana: http://localhost:3000  (admin/admin)
# OTLP HTTP: http://localhost:4318
```

Then point pi-otel at `http://localhost:4318` and run pi.
