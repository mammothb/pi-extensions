import { defineConfig } from "vitest/config";

/**
 * Standalone vitest config for running pi-eval evals.
 *
 * Evals are excluded from the main workspace config (vitest.config.ts)
 * so they never run as part of `pnpm test`. Use this config instead:
 *
 *   # Smoke tests (no LLM, ~60s)
 *   npx vitest run --config vitest.evals.config.ts packages/pi-eval/evals/smoke.test.ts
 *
 *   # Benchmark (requires LLM API key, ~10 min)
 *   BENCHMARK=1 npx vitest run --config vitest.evals.config.ts packages/pi-eval/evals/benchmark.test.ts
 */
export default defineConfig({
  test: {
    include: ["packages/pi-eval/evals/**/*.test.ts"],
    coverage: { enabled: false },
  },
});
