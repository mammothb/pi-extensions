# pi-eval Evals

Evaluation and benchmark tests for the pi-eval extension. These are **not** part
of `pnpm test` — use the standalone vitest config instead.

## Smoke Tests

Verify end-to-end extension behavior with real `node` / `python3` subprocesses.
No LLM required. Fast (~60s).

```bash
npx vitest run --config vitest.evals.config.ts packages/pi-eval/evals/smoke.test.ts
```

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
