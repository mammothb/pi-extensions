/**
 * Expensive tests for pi-eval — timeout verification.
 *
 * Each test takes ~30s (waiting for timeout kill). These are excluded
 * from `pnpm test` by the vitest workspace config (include only matches
 * `test/**\/*.test.ts`). Run explicitly:
 *
 *   npx vitest run --config vitest.expensive.config.ts
 */

import { describe, expect, it } from "vitest";
import { createEvalTool } from "../src/eval.js";
import { EvalTimeoutError } from "../src/lib/types.js";
import { hasPython3, mockContext } from "./_helpers.js";

const tool = createEvalTool();
const cwd = process.cwd();

describe("eval — timeout (expensive)", () => {
  it("Python infinite loop is killed by 30s timeout", async () => {
    if (!(await hasPython3())) {
      return;
    }
    await expect(
      tool.execute(
        "p6",
        { language: "python", code: "while True: pass" },
        undefined,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalTimeoutError);
  }, 60_000);

  it("JavaScript infinite loop is killed by 30s timeout", async () => {
    await expect(
      tool.execute(
        "t10",
        { language: "javascript", code: "while(true){}" },
        undefined,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalTimeoutError);
  }, 60_000);
});
