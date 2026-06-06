# pi-eval Evals

End-to-end evaluation and benchmark tests for the pi-eval extension. These are
**not** part of `pnpm test` — they require an LLM API key and are run manually.

Integration tests (no LLM required) live alongside the source in `test/`.

## Benchmark Tests

Compare pi **without** eval (bash + write + read) vs pi **with** eval on
representative code-evaluation tasks. Requires a valid LLM API key.

```bash
BENCHMARK=1 npx vitest run --config vitest.evals.config.ts packages/pi-eval/evals/benchmark.test.ts
```

Metrics collected per task:
- Wall-clock execution time
- Tool call count and tool names
- Token usage (input / output / total)
- Success rate

Results are printed as a comparison table and persisted to
`packages/pi-eval/evals/results/benchmark-<timestamp>.json`.

## Expensive Smoke Tests

Verify timeout behavior with real subprocesses (~60s per test). No LLM required.

```bash
npx vitest run --config vitest.expensive.config.ts
```
