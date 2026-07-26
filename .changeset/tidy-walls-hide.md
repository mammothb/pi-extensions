---
"@mammothb/pi-ghsearch": patch
"@mammothb/pi-memory": patch
"@mammothb/pi-office": patch
"@mammothb/pi-subagents": minor
---

pi-ghsearch: safer type coercion in search result and fetch-type-detector formatting (objects now return fallback instead of "[object Object]")
pi-memory: thread scopePrefix through recall pipeline
pi-office: fix truncated preview message to show actual maxChars instead of hardcoded "2000"
pi-subagents: sandbox isolation via bubblewrap, fork sessions with parent context inheritance, subagent_resume tool, launch refactor with injected LaunchChildFn, cwd validation extraction
