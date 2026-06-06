# pi-eval

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
