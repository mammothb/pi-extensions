# @mammothb/pi-ask

## 2.1.1

### Patch Changes

- 14317aa: **pi-mermaid**: Removed extension code (TUI rendering, `/pi-mermaid` command, auto-render hooks). Package is now skills-only — provides the mermaid diagram skill with reference docs and validation scripts.

  **pi-memory, pi-ask, pi-ghsearch, pi-websearch**: Fixed `promptGuidelines` to self-identify their tool name in every bullet. The docs require this because all guidelines from all tools are concatenated flat into one "Guidelines:" section with no grouping. Also trimmed multi-sentence `promptSnippet` values (gh_search, gh_fetch, gh_auth_status, AskUserQuestion) to short one-liners matching the built-in tool standard.

## 2.1.0

### Minor Changes

- 0905aa1: Add desktop toast notifications for AskUserQuestion prompts and permission dialogs. Extensions now emit events on `pi.events` so `pi-toast` can listen and notify; shared types defined in `pi-shared`.

### Patch Changes

- Updated dependencies [0905aa1]
  - @mammothb/pi-shared@1.3.0

## 2.0.0

### Major Changes

- 11b514d: Renamed tool from `ask` to `AskUserQuestion` to improve trigger rate with interview/grill-style skills. Prompt improvements: changed framing from "before proceeding" to "during execution", added vocabulary bridge guideline, moved anti-plain-text rule to first position, and simplified recommendation mechanism.

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

## 1.0.1

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

## 1.0.0

### Major Changes

- 86af37a: Initial major release of pi-ask
