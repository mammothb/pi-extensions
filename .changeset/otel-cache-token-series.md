---
"@mammothb/pi-otel": minor
---

Record prompt-cache tokens instead of dropping them. Providers exclude cached
tokens from the input count (Anthropic `cache_read_input_tokens` /
`cache_creation_input_tokens`, Bedrock Converse `cacheReadInputTokens` /
`cacheWriteInputTokens`), so for Claude models — where pi's provider layer
places a cache breakpoint at the end of the prompt — the recorded
`gen_ai.token.type=input` series was near zero on every call.

`gen_ai.client.token.usage` now also emits `cache_read` / `cache_write`
series (custom `gen_ai.token.type` values, allowed by the semconv), and chat
spans carry `gen_ai.usage.cache_read_input_tokens` /
`gen_ai.usage.cache_write_input_tokens`. True prompt size is
`input + cache_read + cache_write`; zero-valued caches are skipped.
