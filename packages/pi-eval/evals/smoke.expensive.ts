/**
 * Expensive smoke tests for pi-eval — timeout verification.
 *
 * Each test takes ~30s. Excluded from default runs by file naming
 * convention (`*.expensive.ts` instead of `*.test.ts`). Run explicitly:
 *
 *   npx vitest run --config vitest.expensive.config.ts
 */

import { describe, expect, it } from "vitest";
import { createEvalTool } from "../src/eval.js";
import { EvalTimeoutError } from "../src/lib/types.js";
import { hasPython3, mockContext } from "../test/_helpers.js";

const tool = createEvalTool();
const cwd = process.cwd();

describe("smoke: timeout (expensive)", () => {
  it("JavaScript infinite loop is killed by 30s timeout", async () => {
    await expect(
      tool.execute(
        "safe2",
        { language: "javascript", code: "while(true){}" },
        undefined,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalTimeoutError);
  }, 60_000);

  it("Python infinite loop is killed by 30s timeout", async () => {
    if (!(await hasPython3())) {
      return;
    }
    await expect(
      tool.execute(
        "safe3",
        { language: "python", code: "while True: pass" },
        undefined,
        undefined,
        mockContext(cwd),
      ),
    ).rejects.toThrow(EvalTimeoutError);
  }, 60_000);
});
