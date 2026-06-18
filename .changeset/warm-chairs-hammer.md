---
"@mammothb/pi-hashline": minor
---

Initial hashline implementation: content-addressed read/edit/write/grep with stale-edit protection.

- **read**: emits `¶PATH#TAG` headers and records content snapshots
- **edit**: validates tags before applying anchored edits, with automatic recovery from stale tags (3-way merge + anchor-content replay)
- **write**: records snapshots and returns `¶PATH#TAG` headers for immediate editing
- **grep**: wraps ripgrep with `¶PATH#TAG` headers per matching file, supports `glob`, `context`, `ignoreCase`, and `literal` modes
- **Recovery**: two-strategy stale-tag recovery (structured-patch 3-way merge + anchor-content replay)
- **Prompt injection**: grammar reference injected into system prompt before each agent turn
