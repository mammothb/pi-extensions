---
"@mammothb/pi-otel": minor
---

Record prompt-cache tokens and make `input` the inclusive prompt size.

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
