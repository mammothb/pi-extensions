/**
 * Benchmark / demonstration tests for pi-eval extension.
 *
 * Compares pi WITHOUT eval (using bash+write+read) vs pi WITH eval
 * on a set of representative code-evaluation tasks. Measures:
 *   - Wall-clock execution time
 *   - Tool call count (tool_execution_start events)
 *   - Token usage (input/output/total from getSessionStats)
 *   - Success rate (does the final answer contain expected output?)
 *
 * Gate: set BENCHMARK=1 to run (requires valid LLM API key).
 *
 * Run:
 *   BENCHMARK=1 npx vitest run packages/pi-eval/evals/benchmark.test.ts
 *
 * Each run produces a summary table comparing both approaches.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type SessionStats,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

// ── Types ─────────────────────────────────────────────────────

/** A single benchmark task: a prompt that exercises code evaluation. */
interface BenchmarkTask {
  id: string;
  prompt: string;
  /** Substring that must appear in the final assistant response */
  expectedInResponse: string;
}

/** Metrics collected for one task run. */
interface TaskMetrics {
  taskId: string;
  wallTimeMs: number;
  toolCalls: number;
  toolNames: string[];
  tokens: { input: number; output: number; total: number };
  success: boolean;
  error?: string;
}

/** Aggregate metrics for a configuration (with/without eval). */
interface AggregateMetrics {
  totalWallTimeMs: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  successCount: number;
  failureCount: number;
  perTask: TaskMetrics[];
}

// ── Tasks ─────────────────────────────────────────────────────

/** Tasks designed to trigger code evaluation that the agent can solve. */
const TASKS: BenchmarkTask[] = [
  {
    id: "regex",
    prompt:
      "Write a short JavaScript program to test if the regex /\\d+/g matches 'abc123def' and tell me the result. Just output the matches — don't create any persistent files.",
    expectedInResponse: "123",
  },
  {
    id: "json",
    prompt:
      'Write a short Python program to validate that the JSON string \'{"name":"Alice","age":30}\' is valid and print the name field. Just output the name — don\'t create any persistent files.',
    expectedInResponse: "Alice",
  },
  {
    id: "hash",
    prompt:
      "Use Node.js to compute the SHA-256 hash of the string 'hello' and tell me the hex digest. Just output the hash — don't create any persistent files.",
    expectedInResponse: "2cf24dba",
  },
];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Run a single task on a session and collect metrics.
 */
async function runTask(
  session: AgentSession,
  task: BenchmarkTask,
  timeoutMs: number,
): Promise<TaskMetrics> {
  const startTime = performance.now();
  const toolCalls: string[] = [];
  let lastAssistantText = "";

  const unsub = session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      toolCalls.push(event.toolName);
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      lastAssistantText += event.assistantMessageEvent.delta;
    }
  });

  let statsBefore: SessionStats | null = null;
  try {
    statsBefore = session.getSessionStats();
  } catch {
    // stats may not be available on first call
  }

  try {
    const promptPromise = session.prompt(task.prompt);
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), timeoutMs),
    );

    const result = await Promise.race([
      promptPromise.then(() => "ok" as const),
      timeout,
    ]);

    if (result === "timeout") {
      session.abort();
      return {
        taskId: task.id,
        wallTimeMs: performance.now() - startTime,
        toolCalls: toolCalls.length,
        toolNames: toolCalls,
        tokens: { input: 0, output: 0, total: 0 },
        success: false,
        error: `Timeout after ${timeoutMs}ms`,
      };
    }
  } catch (err: any) {
    return {
      taskId: task.id,
      wallTimeMs: performance.now() - startTime,
      toolCalls: toolCalls.length,
      toolNames: toolCalls,
      tokens: { input: 0, output: 0, total: 0 },
      success: false,
      error: err.message,
    };
  } finally {
    unsub();
  }

  const wallTimeMs = performance.now() - startTime;

  // Collect token stats
  let tokens = { input: 0, output: 0, total: 0 };
  try {
    const statsAfter = session.getSessionStats();
    if (statsBefore) {
      tokens = {
        input: statsAfter.tokens.input - statsBefore.tokens.input,
        output: statsAfter.tokens.output - statsBefore.tokens.output,
        total: statsAfter.tokens.total - statsBefore.tokens.total,
      };
    } else {
      tokens = {
        input: statsAfter.tokens.input,
        output: statsAfter.tokens.output,
        total: statsAfter.tokens.total,
      };
    }
  } catch {
    // stats unavailable
  }

  const success =
    lastAssistantText.length > 0 &&
    lastAssistantText.includes(task.expectedInResponse);

  return {
    taskId: task.id,
    wallTimeMs,
    toolCalls: toolCalls.length,
    toolNames: toolCalls,
    tokens,
    success,
  };
}

/**
 * Run all tasks on a freshly-created session.
 */
async function runAllTasks(
  tasks: BenchmarkTask[],
  withEval: boolean,
  timeoutPerTask: number,
): Promise<AggregateMetrics> {
  const perTask: TaskMetrics[] = [];

  // Use fresh sessions per task to isolate token tracking
  // (but we could also reuse — fresh is cleaner for per-task stats)
  for (const task of tasks) {
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      additionalExtensionPaths: withEval
        ? [path.resolve(import.meta.dirname, "..", "index.ts")]
        : [],
    });
    await loader.reload();

    const toolNames = withEval
      ? ["read", "bash", "edit", "write", "eval"]
      : ["read", "bash", "edit", "write"];

    const { session } = await createAgentSession({
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      tools: toolNames,
    } as any);

    try {
      const metrics = await runTask(session, task, timeoutPerTask);
      perTask.push(metrics);
    } finally {
      session.dispose();
    }
  }

  return {
    totalWallTimeMs: perTask.reduce((s, t) => s + t.wallTimeMs, 0),
    totalToolCalls: perTask.reduce((s, t) => s + t.toolCalls, 0),
    totalInputTokens: perTask.reduce((s, t) => s + t.tokens.input, 0),
    totalOutputTokens: perTask.reduce((s, t) => s + t.tokens.output, 0),
    totalTokens: perTask.reduce((s, t) => s + t.tokens.total, 0),
    successCount: perTask.filter((t) => t.success).length,
    failureCount: perTask.filter((t) => !t.success).length,
    perTask,
  };
}

/**
 * Print a side-by-side comparison table.
 */
function printComparison(
  tasks: BenchmarkTask[],
  withoutEval: AggregateMetrics,
  withEval: AggregateMetrics,
): void {
  const border = "═".repeat(80);
  const thin = "─".repeat(80);

  console.log(`\n${border}`);
  console.log("  BENCHMARK: bash+write vs eval");
  console.log(border);

  // Header
  console.log(
    `  ${"Task".padEnd(12)} ${"Metric".padEnd(24)} ${"Without Eval".padEnd(18)} ${"With Eval".padEnd(18)} ${"Δ".padEnd(12)}`,
  );
  console.log(`  ${thin}`);

  // Per-task rows
  for (const task of tasks) {
    const noEval = withoutEval.perTask.find((t) => t.taskId === task.id);
    const yesEval = withEval.perTask.find((t) => t.taskId === task.id);

    const rows: Array<[string, number | string, number | string, string?]> = [
      [
        "Time (s)",
        noEval ? (noEval.wallTimeMs / 1000).toFixed(1) : "-",
        yesEval ? (yesEval.wallTimeMs / 1000).toFixed(1) : "-",
      ],
      ["Tool calls", noEval?.toolCalls ?? "-", yesEval?.toolCalls ?? "-"],
      [
        "Input tokens",
        noEval?.tokens.input ?? "-",
        yesEval?.tokens.input ?? "-",
      ],
      [
        "Output tokens",
        noEval?.tokens.output ?? "-",
        yesEval?.tokens.output ?? "-",
      ],
      [
        "Success",
        noEval?.success ? "✅" : "❌",
        yesEval?.success ? "✅" : "❌",
      ],
    ];

    for (let i = 0; i < rows.length; i++) {
      const [metric, noVal, yesVal] = rows[i]!;
      const label = i === 0 ? task.id : "";
      const delta =
        typeof noVal === "number" && typeof yesVal === "number"
          ? yesVal - noVal
          : "-";

      console.log(
        `  ${label.padEnd(12)} ${metric.padEnd(24)} ${String(noVal).padEnd(18)} ${String(yesVal).padEnd(18)} ${String(delta).padEnd(12)}`,
      );
    }
    console.log(`  ${thin}`);
  }

  // Totals
  const totalRows: Array<[string, number | string, number | string]> = [
    [
      "Total time (s)",
      (withoutEval.totalWallTimeMs / 1000).toFixed(1),
      (withEval.totalWallTimeMs / 1000).toFixed(1),
    ],
    ["Total tool calls", withoutEval.totalToolCalls, withEval.totalToolCalls],
    [
      "Total input tokens",
      withoutEval.totalInputTokens,
      withEval.totalInputTokens,
    ],
    [
      "Total output tokens",
      withoutEval.totalOutputTokens,
      withEval.totalOutputTokens,
    ],
    ["Total tokens", withoutEval.totalTokens, withEval.totalTokens],
    [
      "Success rate",
      `${withoutEval.successCount}/${tasks.length}`,
      `${withEval.successCount}/${tasks.length}`,
    ],
  ];

  console.log(
    `  ${"TOTALS".padEnd(12)} ${"".padEnd(24)} ${"".padEnd(18)} ${"".padEnd(18)} ${"".padEnd(12)}`,
  );
  for (const [metric, noVal, yesVal] of totalRows) {
    console.log(
      `  ${"".padEnd(12)} ${metric.padEnd(24)} ${String(noVal).padEnd(18)} ${String(yesVal).padEnd(18)} ${"".padEnd(12)}`,
    );
  }

  // Tool name breakdown
  console.log(`\n  Tool call breakdown (with eval):`);
  for (const t of withEval.perTask) {
    console.log(`    ${t.taskId}: [${t.toolNames.join(", ")}]`);
  }
  console.log(`\n  Tool call breakdown (without eval):`);
  for (const t of withoutEval.perTask) {
    console.log(`    ${t.taskId}: [${t.toolNames.join(", ")}]`);
  }

  console.log(`${border}\n`);

  // Persist results to a timestamped JSON file
  const resultsDir = path.join(import.meta.dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsPath = path.join(resultsDir, `benchmark-${timestamp}.json`);
  const resultsData = {
    timestamp: new Date().toISOString(),
    tasks: tasks.map((t) => ({ id: t.id, prompt: t.prompt })),
    withoutEval: {
      ...withoutEval,
      perTask: withoutEval.perTask.map((m) => ({
        ...m,
        wallTimeMs: Math.round(m.wallTimeMs),
      })),
    },
    withEval: {
      ...withEval,
      perTask: withEval.perTask.map((m) => ({
        ...m,
        wallTimeMs: Math.round(m.wallTimeMs),
      })),
    },
  };
  fs.writeFileSync(resultsPath, JSON.stringify(resultsData, null, 2), "utf-8");
  console.log(`  Results saved to: ${resultsPath}\n`);
}

// ── Tests ─────────────────────────────────────────────────────

const runBenchmark = process.env.BENCHMARK === "1";

if (runBenchmark) {
  describe("benchmark: bash+write vs eval", () => {
    const TIMEOUT_PER_TASK = 120_000; // 2 minutes per task

    it(
      "runs all tasks and prints comparison table",
      async () => {
        console.log(
          "\n🏃 Running WITHOUT eval extension (bash + write + read)...\n",
        );
        const withoutEval = await runAllTasks(TASKS, false, TIMEOUT_PER_TASK);

        console.log("\n🏃 Running WITH eval extension...\n");
        const withEval = await runAllTasks(TASKS, true, TIMEOUT_PER_TASK);

        printComparison(TASKS, withoutEval, withEval);

        // At minimum, with-eval should not be worse than without-eval
        // (it should use fewer tool calls for the same tasks)
        expect(withEval.successCount).toBeGreaterThanOrEqual(
          withoutEval.successCount,
        );
      },
      TASKS.length * 2 * TIMEOUT_PER_TASK + 30_000,
    );
  });
} else {
  describe("benchmark: bash+write vs eval", () => {
    it("skipped — set BENCHMARK=1 to run", () => {
      console.log("  BENCHMARK=1 not set. Skipping real-LLM benchmark tests.");
      console.log(
        "  Run: BENCHMARK=1 npx vitest run packages/pi-eval/evals/benchmark.test.ts",
      );
    });
  });
}
