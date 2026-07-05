---
"@mammothb/pi-memory": patch
---

Refactor internal structure: flatten directory layout, extract shared modules
(`buildOwnCut`, `collectLiveMessages`, recall pipeline), eliminate dead code,
factory-wrap mutable state, reduce `any` casts via `BranchEntry` type, and
consolidate compact-domain types into `types.ts`. No behavioral changes.
