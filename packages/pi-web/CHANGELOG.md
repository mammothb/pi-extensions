# @mammothb/pi-web

## 6.0.2

### Patch Changes

- b913f85: Refactor rendering, error handling, and parsing internals across packages. Fixes include: trigger `${N:-default}` expansion with empty values, eval signal line parsing, document merged-cell handling, and GitHub URL shortening.
- Updated dependencies [b913f85]
  - @mammothb/pi-shared@1.4.1

## 6.0.1

### Patch Changes

- ad39c9b: add .env

## 6.0.0

### Major Changes

- a82212b: Merge `@mammothb/pi-webfetch` and `@mammothb/pi-websearch` into a single `@mammothb/pi-web` package.

  Provides both `WebFetch` and `WebSearch` tools in one install. Config file renamed from `pi-websearch.json` to `pi-web.json`. Users of either old package should uninstall them and install `@mammothb/pi-web` instead. Tool names remain unchanged — no LLM prompt updates needed.

## 5.0.0

### Major Changes

- Initial release merging `@mammothb/pi-webfetch` and `@mammothb/pi-websearch` into a single package.
- Provides both `WebFetch` and `WebSearch` tools.
- Config file renamed from `pi-websearch.json` to `pi-web.json`.
- SearXNG Docker lifecycle management included (from pi-websearch).
