# CONTEXT — @mammothb/pi-otel

Glossary scoped to this extension.

## Terminology

**Session** — a pi conversation persisted to a session file. Always an
attribute, never a span. _Avoid_: conversation, thread (they
exist only as the `gen_ai.conversation.id` alias).

**Interaction** — one user prompt through `agent_end` (including retries,
auto-compaction, and follow-ups). The root span of a trace. _Avoid_: request,
prompt (too narrow).

**Turn** — one LLM response plus the tool executions it triggered. _Avoid_:
iteration, step.

**Chat span** — one provider LLM call, modeled per GenAI semconv
(`gen_ai.operation.name=chat`).

**Tool span** — one tool execution, modeled per GenAI semconv
(`gen_ai.operation.name=execute_tool`).

**Capture mode** — whether raw content (prompts/tool I/O/provider payloads)
is emitted, versus metadata-only (hashes/counts/durations).

## Attribute namespaces

- `gen_ai.*` — OpenTelemetry GenAI semantic conventions, applied where the
  spec covers the concept (LLM calls, tool executions, token usage, nested
  agents). Constants live in `src/attrs.ts`, hand-defined (the semconv is
  `Development`-status).
- `pi.*` — harness-specific concepts the semconv doesn't cover (session,
  interaction, turn index, capture hashes). Same file.

## Content capture

Default is metadata-only: sha256 hashes (`pi.tool.args_sha256`,
`pi.tool.result_sha256`), counts, durations, token usage, model names. Raw
content is gated behind four independent `capture.*` flags, each off by
default, truncated to `summaryLength` (512) when enabled.
