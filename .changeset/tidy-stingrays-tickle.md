---
"@mammothb/pi-shared": minor
"@mammothb/pi-ask": patch
"@mammothb/pi-permissions": minor
"@mammothb/pi-memory": patch
"@mammothb/pi-toast": patch
"@mammothb/pi-websearch": patch
"@mammothb/pi-eval": patch
"@mammothb/pi-ghsearch": patch
---

## pi-shared

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
