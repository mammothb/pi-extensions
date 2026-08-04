---
"@mammothb/pi-ghsearch": patch
---

Validate numeric fields before string conversion in `detectFetchType` and guard `safeStr` against object arguments to prevent `[object Object]` in summaries.
