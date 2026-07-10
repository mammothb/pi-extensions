---
"@mammothb/pi-web": major
---

Merge `@mammothb/pi-webfetch` and `@mammothb/pi-websearch` into a single `@mammothb/pi-web` package.

Provides both `WebFetch` and `WebSearch` tools in one install. Config file renamed from `pi-websearch.json` to `pi-web.json`. Users of either old package should uninstall them and install `@mammothb/pi-web` instead. Tool names remain unchanged — no LLM prompt updates needed.
