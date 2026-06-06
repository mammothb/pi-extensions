---
"@mammothb/pi-eval": minor
---

Improve correctness, clarity, and test coverage across the eval tool

- **Language validation**: unknown language values now throw `EvalUnsupportedLanguageError` instead of silently falling through to JavaScript execution
- **Error discrimination**: user cancellation (Escape) now correctly throws `EvalCancelledError` instead of conflating with `EvalTimeoutError`
- **Exit signal reporting**: `EvalDetails` now includes `exitSignal` (e.g. `"SIGTERM"`) and `exitCode` is `number | null` — no longer masks signal kills as exit code 0
- **Output truncation fix**: partial-chunk truncation edge case resolved — truncated flag is set immediately when output exceeds the 1 MB cap mid-chunk
- **README**: Python support documented (no longer marked as "coming in a future release")
- **Internal**: consolidated duplicate test suites, extracted shared test helpers, replaced `as any` casts with typed `mockContext`, renamed `handleResult` → `assertSuccessOrThrow` for clarity, switched `formatOutput` to named options
