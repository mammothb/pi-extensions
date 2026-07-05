# @mammothb/pi-memory

## 1.1.0

### Minor Changes

- b1df743: Add `#skill:name` and `#prompt:name` mid-text autocomplete via
  `AutocompleteProviderFactory`. Switch trigger prefix from `/` to `#`
  so autocomplete fires on any line, not just line 0 (editor restricts
  `/`-triggered autocomplete to the first line only).

  Also replace local `homePath` with `expandTilde` from `@mammothb/pi-shared`,
  and use `getAgentDir()` instead of hardcoded `~/.pi/agent` paths.

## 1.0.1

### Patch Changes

- 22ff42a: Refactor internal structure: flatten directory layout, extract shared modules
  (`buildOwnCut`, `collectLiveMessages`, recall pipeline), eliminate dead code,
  factory-wrap mutable state, reduce `any` casts via `BranchEntry` type, and
  consolidate compact-domain types into `types.ts`. No behavioral changes.

## 1.0.0

### Major Changes

- 476efaa: Replace persistent key-value memory with VCC conversation compaction backed by mm-cli.

  - Remove `retain`, `recall`, `reflect`, `memory_edit`, `compact_memory` tools
  - Add `memory_recall` tool for session history search (BM25 scoring, regex, pagination)
  - Add `/pi-memory` and `/pi-memory-recall` commands
  - Register `before_compact` hook — delegates compaction to `mm pi` subprocess
  - Remove `@mammothb/pi-shared` dependency
  - Remove system prompt injection of memory reflection instructions

## 0.3.6

### Patch Changes

- d1e19c5: Tighten tool prompts for token efficiency: trim bloated descriptions, add missing `promptGuidelines`, ensure every guideline names its tool explicitly per pi SDK convention

## 0.3.5

### Patch Changes

- 9d54440: strict semantic for pi-hashline, per line hashing, atomic io.
- Updated dependencies [9d54440]
  - @mammothb/pi-shared@1.3.1

## 0.3.4

### Patch Changes

- 14317aa: **pi-mermaid**: Removed extension code (TUI rendering, `/pi-mermaid` command, auto-render hooks). Package is now skills-only — provides the mermaid diagram skill with reference docs and validation scripts.

  **pi-memory, pi-ask, pi-ghsearch, pi-websearch**: Fixed `promptGuidelines` to self-identify their tool name in every bullet. The docs require this because all guidelines from all tools are concatenated flat into one "Guidelines:" section with no grouping. Also trimmed multi-sentence `promptSnippet` values (gh_search, gh_fetch, gh_auth_status, AskUserQuestion) to short one-liners matching the built-in tool standard.

## 0.3.3

### Patch Changes

- Updated dependencies [0905aa1]
  - @mammothb/pi-shared@1.3.0

## 0.3.2

### Patch Changes

- c1a4358: Naming consistency pass across all packages:

  - `IEditorAdapter` → `EditorAdapter` (drop lone `I` prefix)
  - `QuestionT`/`ResultT`/`OptionT` → `Question`/`AskResult`/`Option` (drop `T` suffix on types; schema values use `Schema` suffix)
  - `GhSearchParamsT` → `GhSearchParams`, `GhSearchParams` → `GhSearchParamsSchema`
  - `AskParams` → `AskParamsSchema`
  - `private` fields → `#` private fields in `AskComponent` and `ApprovalCache`
  - `onOther` → `isOnOther` (boolean prefix convention)
  - `mergeConfigs` → `mergeConfig` (singular)
  - `err` → `err` in all catch blocks, `error` → `err` in webfetch/providers
  - `filepath` → `filePath` (camelCase)
  - `allOptions` → `getOptions` (misleading name: not a predicate)
  - `backend.remember()` → `backend.retain()`, `RememberParams` → `RetainParams`
  - `checkShutdownHealth` → `inspectShutdownState`, `ShutdownHealth` → `ShutdownState`
  - `InputContext` → `InputDeps`
  - `context` → `ctx` in all `renderCall`/`renderResult` signatures

- Updated dependencies [c1a4358]
- Updated dependencies [c1a4358]
  - @mammothb/pi-shared@1.2.1

## 0.3.1

### Patch Changes

- 1d59c93: ## pi-shared

  - Added `BgSafeTruncatedText`, a `TruncatedText` subclass that preserves parent background colors when text is truncated with an ellipsis.
  - Added `loadPiConfig` and `readConfigFile` — shared utilities for loading extension config from JSON files with defaults → global → project merging.

  ## pi-ask

  - Now uses `BgSafeTruncatedText` in `renderCall` and `renderResult` so the ask tool renders correctly on colored backgrounds (toolSuccessBg, toolErrorBg, toolPendingBg).

  ## pi-permissions (new)

  - New package providing tool, path, and bash permission guards.
  - Wildcard-based pattern matching with last-match-wins semantics.
  - In-memory session approval cache to avoid re-prompting.
  - Bash arbiter support for external command allowlisting.
  - Headless mode gracefully denies by default.

  ## pi-memory

  - Refactored storage layer to a `FileSystemBackend` abstraction.
  - All tool entry points now accept a backend instance.
  - search, TTL, namespace filtering, and index management moved into the backend.
  - Tests rewritten to exercise the backend directly.

  ## pi-toast

  - Refactored config loading to use shared `loadPiConfig` from `@mammothb/pi-shared`.

  ## pi-websearch

  - Refactored config loading to use shared `loadPiConfig` from `@mammothb/pi-shared`.
  - Fixed potential undefined access when parsing SearXNG shutdown PID files.

  ## pi-eval

  - Refactored config loading to use shared `loadPiConfig` from `@mammothb/pi-shared`.

  ## pi-ghsearch

  - Refactored config loading to use shared `loadPiConfig` from `@mammothb/pi-shared`.
  - `loadConfig` is now synchronous (removed async file reading).

- Updated dependencies [1d59c93]
  - @mammothb/pi-shared@1.2.0

## 0.3.0

### Minor Changes

- 96c5a1d: Refactor memory to use a backend abstraction, with a filesystem backend as the default. Tools (retain, recall, reflect, memory-edit, compact-memory) are now thin adapters that delegate to the backend. The old `store.ts` module and its functions (`loadIndex`, `saveIndex`, `hashCwd`) have been removed from the public API.

## 0.2.0

### Minor Changes

- cb764c5: Add `pi-memory` extension: persistent agent memory across sessions with namespaced key-value storage, optional TTL, automatic compaction, reflection-driven summarization, and a memory editing tool
