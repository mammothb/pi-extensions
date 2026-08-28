# @mammothb/pi-office

## 0.2.1

### Patch Changes

- bc5d8bc: Fix SharePoint URL-parsing tests to match the corrected parser

  Aligns the `load-sharepoint-url`, `load-sharepoint-client`, and
  `load-sharepoint-tool` tests with the sharepoint URL parsing fix: the
  document-library segment (`Shared Documents`, `Documents`, …) is dropped from
  the drive-relative `itemPath`, and editor URLs keep only the `sourcedoc` query
  param before the Graph shares endpoint resolves them. Test inputs that placed a
  file directly under a `/sites/{site}` path now use a library folder so they
  parse instead of throwing.

## 0.2.0

### Minor Changes

- 0152f03: Add SharePoint file loading to pi-office and `cmd:` token source to pi-shared

  pi-office gains an opt-in `load_sharepoint` tool that downloads files from
  SharePoint via Microsoft Graph and writes them to a local temp path for the
  reader tools (`read_pdf`, `read_docx`, `read_xlsx`). Accepted URL shapes:
  direct document URLs, Office editor URLs (`_layouts/15/Doc.aspx?sourcedoc={GUID}`),
  share links (`/:x:/r/...`, resolved via the Graph shares endpoint when the path
  is not embedded), and browser folder-view URLs (`AllItems.aspx?id=...`).
  OneDrive for Business hosts (`*-my.sharepoint.com/personal/...`) are supported.
  Configure it in `~/.pi/agent/pi-office.json` or `.pi/pi-office.json`:

  ```json
  {
    "sharepoint": {
      "tokenSource": "env:GRAPH_TOKEN",
      "baseUrl": "https://graph.microsoft.com/v1.0"
    }
  }
  ```

  `baseUrl` defaults to the global Graph endpoint; override it for sovereign
  clouds (e.g. `https://graph.microsoft.us`).

  pi-shared's `resolveSecret` now supports a `cmd:` prefix alongside `env:` and
  `file:`: `cmd:command args` runs the command (no shell, quotes respected) and
  returns trimmed stdout.

### Patch Changes

- Updated dependencies [0152f03]
  - @mammothb/pi-shared@1.6.0

## 0.1.8

### Patch Changes

- Updated dependencies [ab5640c]
  - @mammothb/pi-shared@1.5.0

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
