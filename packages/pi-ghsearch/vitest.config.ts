import { defineConfig } from "vitest/config";

// Unit tests live in test/ and run on every `vitest run`.
// Eval/integration tests live in evals/ and require the real `gh` CLI
// plus network access — they are excluded from the default include.
// Run them explicitly with:
//   npx vitest run evals/<file>.test.ts
// (requires temporary edit of the include pattern below, or a separate config.)
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
