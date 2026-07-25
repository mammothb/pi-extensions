---
"@mammothb/pi-ask": patch
"@mammothb/pi-eval": patch
"@mammothb/pi-ghsearch": patch
"@mammothb/pi-memory": patch
"@mammothb/pi-office": patch
"@mammothb/pi-permissions": patch
"@mammothb/pi-shared": patch
"@mammothb/pi-stats": minor
"@mammothb/pi-subagents": patch
"@mammothb/pi-trigger": patch
"@mammothb/pi-web": patch
---

Refactor rendering, error handling, and parsing internals across packages. Fixes include: trigger `${N:-default}` expansion with empty values, eval signal line parsing, document merged-cell handling, and GitHub URL shortening.
