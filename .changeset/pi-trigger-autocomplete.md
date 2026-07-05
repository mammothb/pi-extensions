---
"@mammothb/pi-memory": minor
"@mammothb/pi-trigger": minor
---

Add `#skill:name` and `#prompt:name` mid-text autocomplete via
`AutocompleteProviderFactory`. Switch trigger prefix from `/` to `#`
so autocomplete fires on any line, not just line 0 (editor restricts
`/`-triggered autocomplete to the first line only).

Also replace local `homePath` with `expandTilde` from `@mammothb/pi-shared`,
and use `getAgentDir()` instead of hardcoded `~/.pi/agent` paths.
