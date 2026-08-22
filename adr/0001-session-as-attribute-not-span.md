# 0001 — Session as attribute, not span

- **Status:** Accepted
- **Date:** 2026-01-22
- **Deciders:** `@mammothb/pi-otel` design

## Context

A pi session is a long-lived conversation persisted to a session file. It
spans many user prompts, many agent turns, model switches, compactions, and
forks. The question for `@mammothb/pi-otel` is how to model it in an
OpenTelemetry trace tree.

Two options were considered:

1. **Session as a root span** — open a `pi.session` span at `session_start`,
   close it at `session_shutdown`. All interactions are children of that
   single span.
2. **Session as an attribute** — every span carries
   `pi.session.id` (and its `gen_ai.conversation.id` alias). Each
   interaction is its own root span; sessions are queryable but not modeled
   in the span tree.

## Decision

Sessions are **attributes**, not spans. Each user prompt (`before_agent_start`
through `agent_end`) is a root span, and every span — at any level — carries:

- `pi.session.id` — the session identifier (from `ctx.sessionManager`)
- `gen_ai.conversation.id` — same value, for GenAI-semconv interop

Resource attributes (`service.name`, `host.name`, `user.*`) are set on the
SDK's `Resource` and inherit automatically.

## Consequences

### Positive

- The OTel span tree mirrors the unit of work (one user prompt = one trace),
  matching how operators reason about latency, errors, and token cost.
- No long-lived-span anti-pattern. A session can run for hours; spans should
  not.
- Trace sampling, per-span tail-based decisions, and trace search by session
  all work without restructuring.
- Aligns with GenAI semconv, which defines `gen_ai.conversation.id` as an
  attribute, not a span kind.

### Negative

- Session-level metrics (e.g. "tokens per session") cannot be summed via
  trace queries alone — they require aggregation across traces by
  `pi.session.id`. We expose a `pi.prompt.count` counter to make this
  queryable directly.
- A tool that walks span parents expecting to reach the session root will
  hit the trace root (the interaction) instead. This is the intended
  behavior; the interaction root is the right anchor.

### Neutral

- The `pi.*` attribute namespace carries `pi.session.id` and
  `pi.interaction.id` separately so dashboards can group either way.

## Alternatives considered

- **Session as root span with sampled children** — sampling then becomes
  binary per session, defeating sampling's purpose.
- **Session as a `Link` on every span** — `Link` is for related but separate
  operations; the session contains every operation. Misuse.
- **No session identity in traces at all** — operators cannot answer "show
  me everything that happened in session X" without the attribute.

## References

- OpenTelemetry long-lived-span guidance: spans should represent a single
  unit of work, not an application lifecycle.
- OpenTelemetry GenAI semantic conventions:
  `gen_ai.conversation.id` defined as an attribute, not a span.
- Prior art: `NikiforovAll/pi-otel` (session as attribute, the closest
  match); `mprokopov/pi-otel-telemetry` and `maxmalkin/pi-OTEL` (session as
  root span — rejected).
