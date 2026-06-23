# @mammothb/pi-hashline

## 1.0.1

### Patch Changes

- 7bed6a2: Fix hash-anchored line format gaps: grep output, mismatch diagnostics, prefix stripping, prompt instructions, and stale comments now consistently use `HASH│content` format. Remove dead old-format code (`formatNumberedLine`, `parseTag`, etc.).

## 1.0.0

### Major Changes

- 9d54440: strict semantic for pi-hashline, per line hashing, atomic io.

## 0.3.0

### Minor Changes

- b4e8d44: Block-aware editing with treesitter resolution, streaming-tolerant parser, mismatch handling, and render integration.

  - **Block resolution**: Core block resolver extracts code blocks from edit hunks for targeted application. Treesitter block resolver uses tree-sitter grammars (JavaScript, TypeScript, Python, YAML) to identify syntactic boundaries and scope blocks precisely.
  - **Mismatch handling**: Detects, reports, and applies partial patches when hunks don't match exactly. Supports structured mismatch reporting with anchor-content replay for stale-edit recovery.
  - **Streaming-tolerant parser**: Handles partial/incomplete hashline input from streaming LLM output without breaking.
  - **Header parser & multi-file hints**: Parses `¶PATH#TAG` headers to extract file metadata; multi-file hints surface affected files during tool calls.
  - **Diff generator**: Generates unified diffs for patch sections, enabling visual review of changes.
  - **Strict edit mode**: Enforces exact anchor matching before applying edits.
  - **Prefixes system**: Portable prefix definitions for consistent hashline grammar across tools.
  - **Render integration**: Wires hashline tool calls/results into pi's TUI render pipeline for inline result display.

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
