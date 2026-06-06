# pi-eval

## Unreleased

- Language validation: unknown values throw `EvalUnsupportedLanguageError` instead of silently running as JavaScript
- Fix: user cancellation (Escape) now correctly throws `EvalCancelledError`, not `EvalTimeoutError`
- Fix: signal-killed processes no longer report exit code 0 — `exitSignal` field added to `EvalDetails`
- Fix: partial-chunk output truncation edge case resolved
- Python support documented (was incorrectly marked "coming in a future release")

## 0.1.0

- Initial release: JavaScript and Python execution in isolated subprocesses
