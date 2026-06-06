import { defineConfig } from "vitest/config";

/**
 * Standalone config for expensive pi-eval timeout tests (~60s).
 * These are excluded from `pnpm test` by file naming (*.expensive.ts).
 *
 * Run:
 *   npx vitest run --config vitest.expensive.config.ts
 */
export default defineConfig({
  test: {
    include: ["packages/pi-eval/**/*.expensive.ts"],
    coverage: { enabled: false },
  },
});
