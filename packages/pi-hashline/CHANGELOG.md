# @mammothb/pi-hashline

## 0.2.1

### Patch Changes

- aaae8fb: Fix `---` (markdown horizontal rule) silently consumed as envelope separator

  Replaced custom envelope markers (`<<<`/`>>>`/`---`/`...`) with oh-my-pi's
  `*** Begin Patch` / `*** End Patch` / `*** Abort`. This eliminates the
  `envelope-separator` collision where `---` was silently dropped from
  hunk bodies, causing empty-body errors or missing content in markdown edits.

## 0.2.0

### Minor Changes

- a52e8b3: Initial hashline implementation: content-addressed read/edit/write/grep with stale-edit protection.

  - **read**: emits `¶PATH#TAG` headers and records content snapshots
  - **edit**: validates tags before applying anchored edits, with automatic recovery from stale tags (3-way merge + anchor-content replay)
  - **write**: records snapshots and returns `¶PATH#TAG` headers for immediate editing
  - **grep**: wraps ripgrep with `¶PATH#TAG` headers per matching file, supports `glob`, `context`, `ignoreCase`, and `literal` modes
  - **Recovery**: two-strategy stale-tag recovery (structured-patch 3-way merge + anchor-content replay)
  - **Prompt injection**: grammar reference injected into system prompt before each agent turn
