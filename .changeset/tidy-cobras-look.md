---
"@mammothb/pi-memory": minor
---

Refactor memory to use a backend abstraction, with a filesystem backend as the default. Tools (retain, recall, reflect, memory-edit, compact-memory) are now thin adapters that delegate to the backend. The old `store.ts` module and its functions (`loadIndex`, `saveIndex`, `hashCwd`) have been removed from the public API.
