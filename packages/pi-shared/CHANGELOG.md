# @mammothb/pi-shared

## 1.3.0

### Minor Changes

- 0905aa1: Add desktop toast notifications for AskUserQuestion prompts and permission dialogs. Extensions now emit events on `pi.events` so `pi-toast` can listen and notify; shared types defined in `pi-shared`.

## 1.2.1

### Patch Changes

- c1a4358: Fixed a `noControlCharactersInRegex` lint error in `BgSafeTruncatedText` by extracting the ANSI escape character into a constant and building the regex dynamically with `new RegExp()` instead of embedding `\x1b` in a regex literal.
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

## 1.2.0

### Minor Changes

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

## 1.1.0

### Minor Changes

- f7eba7a: Extract common render/utility functions to pi-shared

  - Add `isTextContent`, `extractTextContent`, `firstTextBlock`, `renderError`, `getExpandKey` to `@mammothb/pi-shared`
  - All extension packages now import these from pi-shared instead of duplicating them locally
  - pi-webfetch switches to SDK `formatSize` instead of local copy
  - pi-websearch adds missing error guard in `renderResult`

## 1.0.0

### Major Changes

- d105fe5: add expandTilde to share package. use expandTilde in pi-eval config
