# @mammothb/pi-memory

## 0.3.0

### Minor Changes

- 96c5a1d: Refactor memory to use a backend abstraction, with a filesystem backend as the default. Tools (retain, recall, reflect, memory-edit, compact-memory) are now thin adapters that delegate to the backend. The old `store.ts` module and its functions (`loadIndex`, `saveIndex`, `hashCwd`) have been removed from the public API.

## 0.2.0

### Minor Changes

- cb764c5: Add `pi-memory` extension: persistent agent memory across sessions with namespaced key-value storage, optional TTL, automatic compaction, reflection-driven summarization, and a memory editing tool
