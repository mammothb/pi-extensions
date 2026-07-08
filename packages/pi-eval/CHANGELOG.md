# pi-eval

## 2.2.0

### Minor Changes

- 5de3594: Standardize tool result rendering UX:

  - All error paths use shared `renderError()` with optional `toolLabel` prefix
  - All tools show `Ctrl+O to expand` hint in collapsed results and `Ctrl+O to collapse` in expanded results
  - Shared `getExpandHint(theme, remaining?)` and `getCollapseHint(theme)` utilities in pi-shared
  - Shared `PREVIEW_LINES` constant (7) across eval, webfetch, websearch
  - WebFetch: added `renderCall` showing target URL; fixed error path not using `ctx.isError`; tight collapsed layout; YAML frontmatter stripped from preview
  - WebSearch: error message no longer duplicates tool name prefix
  - gh_search/gh_fetch: error messages strip `gh:` CLI prefix to avoid duplication with toolLabel
  - Tool names extracted to `TOOL_NAME` constants, used consistently in promptGuidelines, renderCall, and renderError

### Patch Changes

- Updated dependencies [5de3594]
  - @mammothb/pi-shared@1.4.0

## 2.1.3

### Patch Changes

- d1e19c5: Tighten tool prompts for token efficiency: trim bloated descriptions, add missing `promptGuidelines`, ensure every guideline names its tool explicitly per pi SDK convention

## 2.1.2

### Patch Changes

- 9d54440: strict semantic for pi-hashline, per line hashing, atomic io.
- Updated dependencies [9d54440]
  - @mammothb/pi-shared@1.3.1

## 2.1.1

### Patch Changes

- Updated dependencies [0905aa1]
  - @mammothb/pi-shared@1.3.0

## 2.1.0

### Minor Changes

- bc1fd07: Added optional `cwd` parameter to the `eval` tool — models can now specify a working directory for subprocess execution. When omitted, defaults to the agent's current working directory (backward compatible). The `cwd` also affects config loading (`.pi/pi-eval.json`), matching the mental model of "run this code in that directory."

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

## 2.0.3

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

## 2.0.2

### Patch Changes

- f7eba7a: Extract common render/utility functions to pi-shared

  - Add `isTextContent`, `extractTextContent`, `firstTextBlock`, `renderError`, `getExpandKey` to `@mammothb/pi-shared`
  - All extension packages now import these from pi-shared instead of duplicating them locally
  - pi-webfetch switches to SDK `formatSize` instead of local copy
  - pi-websearch adds missing error guard in `renderResult`

- f7eba7a: Fix poor text contrast on colored tool backgrounds

  Replace `theme.fg("dim", …)` with `theme.fg("muted", …)` or
  `theme.fg("toolOutput", …)` in all tool renderers. The `dim` color
  (#666666 in dark theme) had only 2.4:1 contrast against `toolSuccessBg`
  (#283228), making secondary text nearly unreadable on green/red tool boxes.

  Also add a "Theme colors in tool renderers" section to CONTRIBUTING.md
  documenting the contrast issue and which colors to use.

- Updated dependencies [f7eba7a]
  - @mammothb/pi-shared@1.1.0

## 2.0.1

### Patch Changes

- 2a0e808: Move internal modules into `src/lib/` for consistency with other packages in the monorepo (`pi-ghsearch`, `pi-webfetch`, `pi-websearch` already follow this pattern)

## 2.0.0

### Major Changes

- d105fe5: add expandTilde to share package. use expandTilde in pi-eval config

### Patch Changes

- Updated dependencies [d105fe5]
  - @mammothb/pi-shared@1.0.0

## 1.1.0

### Minor Changes

- 08ba7fa: Add user-configurable `pythonPath` and `nodeModulesPath` via config files (`~/.pi/agent/pi-eval.json` and `.pi/pi-eval.json`) instead of requiring them as tool parameters on every invocation.

## 1.0.0

### Major Changes

- 45beb4c: pi-eval extension to run JS and Python code with virtual environment support

### Minor Changes

- 351a0b4: Improve correctness, clarity, and test coverage across the eval tool

  - **Language validation**: unknown language values now throw `EvalUnsupportedLanguageError` instead of silently falling through to JavaScript execution
  - **Error discrimination**: user cancellation (Escape) now correctly throws `EvalCancelledError` instead of conflating with `EvalTimeoutError`
  - **Exit signal reporting**: `EvalDetails` now includes `exitSignal` (e.g. `"SIGTERM"`) and `exitCode` is `number | null` — no longer masks signal kills as exit code 0
  - **Output truncation fix**: partial-chunk truncation edge case resolved — truncated flag is set immediately when output exceeds the 1 MB cap mid-chunk
  - **README**: Python support documented (no longer marked as "coming in a future release")
  - **Internal**: consolidated duplicate test suites, extracted shared test helpers, replaced `as any` casts with typed `mockContext`, renamed `handleResult` → `assertSuccessOrThrow` for clarity, switched `formatOutput` to named options

## Unreleased

- Language validation: unknown values throw `EvalUnsupportedLanguageError` instead of silently running as JavaScript
- Fix: user cancellation (Escape) now correctly throws `EvalCancelledError`, not `EvalTimeoutError`
- Fix: signal-killed processes no longer report exit code 0 — `exitSignal` field added to `EvalDetails`
- Fix: partial-chunk output truncation edge case resolved
- Python support documented (was incorrectly marked "coming in a future release")

## 0.1.0

- Initial release: JavaScript and Python execution in isolated subprocesses
