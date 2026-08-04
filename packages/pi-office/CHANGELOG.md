# @mammothb/pi-office

## 0.1.7

### Patch Changes

- 0acecd7: Fix missing `maxChars` parameter in `read_docx` preview builder.

## 0.1.6

### Patch Changes

- 7cfb525: pi-ghsearch: safer type coercion in search result and fetch-type-detector formatting (objects now return fallback instead of "[object Object]")
  pi-memory: thread scopePrefix through recall pipeline
  pi-office: fix truncated preview message to show actual maxChars instead of hardcoded "2000"
  pi-subagents: sandbox isolation via bubblewrap, fork sessions with parent context inheritance, subagent_resume tool, launch refactor with injected LaunchChildFn, cwd validation extraction

## 0.1.5

### Patch Changes

- b913f85: Refactor rendering, error handling, and parsing internals across packages. Fixes include: trigger `${N:-default}` expansion with empty values, eval signal line parsing, document merged-cell handling, and GitHub URL shortening.
- Updated dependencies [b913f85]
  - @mammothb/pi-shared@1.4.1

## 0.1.4

### Patch Changes

- 40fa62a: Add `raw` parameter to `read_xlsx` so the model can request display-formatted values (dates as "3/15/24", currencies as "$1,234.56", percentages as "8.50%") instead of raw numeric storage values. Defaults to `true` for backward compatibility.

## 0.1.3

### Patch Changes

- 5ce9e7c: Bump pi dependencies to 0.80.10

## 0.1.2

### Patch Changes

- Updated dependencies [5de3594]
  - @mammothb/pi-shared@1.4.0

## 0.1.1

### Patch Changes

- d1e19c5: Tighten tool prompts for token efficiency: trim bloated descriptions, add missing `promptGuidelines`, ensure every guideline names its tool explicitly per pi SDK convention
