# @mammothb/pi-webfetch

## 2.1.0

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

## 2.0.3

### Patch Changes

- d1e19c5: Tighten tool prompts for token efficiency: trim bloated descriptions, add missing `promptGuidelines`, ensure every guideline names its tool explicitly per pi SDK convention

## 2.0.2

### Patch Changes

- 9d54440: strict semantic for pi-hashline, per line hashing, atomic io.
- Updated dependencies [9d54440]
  - @mammothb/pi-shared@1.3.1

## 2.0.1

### Patch Changes

- Updated dependencies [0905aa1]
  - @mammothb/pi-shared@1.3.0

## 2.0.0

### Major Changes

- a8b7d82: Renamed `websearch` → `WebSearch` and `webfetch` → `WebFetch` to match Claude Code tool names, improving model trigger rates through ecosystem name recognition.

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

## 1.0.2

### Patch Changes

- Updated dependencies [1d59c93]
  - @mammothb/pi-shared@1.2.0

## 1.0.1

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

## 1.0.0

### Major Changes

- 759d16c: update readme
