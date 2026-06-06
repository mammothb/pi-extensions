/**
 * run-real-eval.test.ts — Real LLM trigger evaluation for pi-ghsearch.
 *
 * Smoke test (runs by default): 2 queries — one should-trigger, one near-miss.
 * Full eval (FULL_EVAL=1): all 12 queries from evals/trigger-evals.json.
 *
 * Usage:
 *   # Smoke test (2 queries, ~2 min)
 *   npx vitest run test/run-real-eval.test.ts
 *
 *   # Full eval (12 queries, ~10-15 min)
 *   FULL_EVAL=1 npx vitest run test/run-real-eval.test.ts
 *
 * Requirements: valid API key in ~/.pi/agent/auth.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvalEntry {
  id: number;
  query: string;
  tool: string;
  should_trigger: boolean;
  should_use?: string;
  rationale: string;
}

interface RunResult {
  queryId: number;
  triggeredTools: string[];
  correct: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const SMOKE_QUERIES: EvalEntry[] = [
  {
    id: 1,
    query:
      "find me some github repos that use typebox with vitest for testing. just list the repo names, don't run any commands.",
    tool: "gh_search",
    should_trigger: true,
    rationale: "User wants to find repos matching criteria",
  },
  {
    id: 9,
    query:
      "run `gh search repos 'typebox' --limit 5` in bash and show me the output",
    tool: "gh_search",
    should_trigger: false,
    should_use: "bash",
    rationale: "Explicitly asks for bash gh — model should NOT call gh_search",
  },
];

const FULL_QUERIES_PATH = path.join(import.meta.dirname, "trigger-evals.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createSession(): Promise<AgentSession> {
  const extPath = path.resolve(import.meta.dirname, "..", "index.ts");
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    additionalExtensionPaths: [extPath],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
    tools: [
      "read",
      "bash",
      "edit",
      "write",
      "gh_search",
      "gh_auth_status",
      "gh_fetch",
    ],
  } as any);

  return session;
}

async function runOneQuery(
  session: AgentSession,
  entry: EvalEntry,
  timeoutMs: number,
): Promise<RunResult> {
  const triggeredTools: string[] = [];

  const unsub = session.subscribe((event: any) => {
    if (event.type === "tool_execution_start") {
      triggeredTools.push(event.toolName);
    }
  });

  try {
    const promptPromise = session.prompt(entry.query);
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
        queryId: entry.id,
        triggeredTools,
        correct: false,
        error: `Timeout after ${timeoutMs}ms`,
      };
    }

    const correct = entry.should_trigger && triggeredTools.includes(entry.tool);
    const correctNegative =
      !entry.should_trigger && !triggeredTools.includes(entry.tool);

    return {
      queryId: entry.id,
      triggeredTools,
      correct: entry.should_trigger ? correct : correctNegative,
    };
  } catch (err: any) {
    return {
      queryId: entry.id,
      triggeredTools,
      correct: false,
      error: err.message,
    };
  } finally {
    unsub();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const QUERY_TIMEOUT = 120_000; // 2 min per query

describe("real LLM trigger eval (smoke)", () => {
  it(
    "should-trigger: gh_search fires for repo search",
    async () => {
      const session = await createSession();
      try {
        const r = await runOneQuery(session, SMOKE_QUERIES[0]!, QUERY_TIMEOUT);
        console.log(
          `  triggered=[${r.triggeredTools.join(",")}] correct=${r.correct} ${r.error || ""}`,
        );
        expect(r.error).toBeUndefined();
        expect(r.correct).toBe(true);
      } finally {
        session.dispose();
      }
    },
    QUERY_TIMEOUT + 15_000,
  );

  it(
    "should-NOT-trigger: gh_search suppressed when user wants bash",
    async () => {
      const session = await createSession();
      try {
        const r = await runOneQuery(session, SMOKE_QUERIES[1]!, QUERY_TIMEOUT);
        console.log(
          `  triggered=[${r.triggeredTools.join(",")}] correct=${r.correct} ${r.error || ""}`,
        );
        expect(r.error).toBeUndefined();
        expect(r.correct).toBe(true);
      } finally {
        session.dispose();
      }
    },
    QUERY_TIMEOUT + 15_000,
  );
});

// Full eval — gated behind FULL_EVAL=1
const runFull = process.env.FULL_EVAL === "1";
if (runFull) {
  describe("real LLM trigger eval (full)", () => {
    const FULL_TIMEOUT = 15 * 60_000; // 15 min for all 12 queries

    it(
      "all 12 queries",
      async () => {
        const entries: EvalEntry[] = JSON.parse(
          fs.readFileSync(FULL_QUERIES_PATH, "utf-8"),
        );

        console.log(`\nFull eval: ${entries.length} queries\n`);

        const results: RunResult[] = [];

        for (const entry of entries) {
          const session = await createSession();
          try {
            const r = await runOneQuery(session, entry, QUERY_TIMEOUT);
            results.push(r);
            const status = r.error ? "ERR" : r.correct ? "PASS" : "FAIL";
            console.log(
              `  ${status} #${entry.id} triggered=[${r.triggeredTools.join(",")}] ` +
                `expected=${entry.tool} should=${entry.should_trigger} ${r.error || ""}`,
            );
          } finally {
            session.dispose();
          }
        }

        const passed = results.filter((r) => r.correct).length;

        // Per-tool stats
        for (const tool of ["gh_search", "gh_fetch", "gh_auth_status"]) {
          const toolEntries = entries.filter((e) => e.tool === tool);
          const toolResults = results.filter((r) =>
            toolEntries.some((e) => e.id === r.queryId),
          );
          const tp = toolResults.filter(
            (r) =>
              toolEntries.find((e) => e.id === r.queryId)!.should_trigger &&
              r.correct,
          ).length;
          const fn = toolResults.filter(
            (r) =>
              toolEntries.find((e) => e.id === r.queryId)!.should_trigger &&
              !r.correct,
          ).length;
          const fp = toolResults.filter(
            (r) =>
              !toolEntries.find((e) => e.id === r.queryId)!.should_trigger &&
              !r.correct,
          ).length;
          const tn = toolResults.filter(
            (r) =>
              !toolEntries.find((e) => e.id === r.queryId)!.should_trigger &&
              r.correct,
          ).length;
          const prec =
            tp + fp > 0 ? ((tp / (tp + fp)) * 100).toFixed(0) : "n/a";
          const rec = tp + fn > 0 ? ((tp / (tp + fn)) * 100).toFixed(0) : "n/a";
          console.log(
            `  ${tool}: TP=${tp} FP=${fp} FN=${fn} TN=${tn} P=${prec}% R=${rec}%`,
          );
        }

        console.log(`\nTotal: ${passed}/${results.length} passed`);
      },
      FULL_TIMEOUT,
    );
  });
}
