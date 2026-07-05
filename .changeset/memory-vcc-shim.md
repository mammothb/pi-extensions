---
"@mammothb/pi-memory": major
---

Replace persistent key-value memory with VCC conversation compaction backed by mm-cli.

- Remove `retain`, `recall`, `reflect`, `memory_edit`, `compact_memory` tools
- Add `memory_recall` tool for session history search (BM25 scoring, regex, pagination)
- Add `/pi-memory` and `/pi-memory-recall` commands
- Register `before_compact` hook — delegates compaction to `mm pi` subprocess
- Remove `@mammothb/pi-shared` dependency
- Remove system prompt injection of memory reflection instructions
