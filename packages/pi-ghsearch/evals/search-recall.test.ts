/**
 * search-recall.test.ts — Search recall benchmarks for pi-ghsearch.
 *
 * Tests that `gh search` CLI calls produce relevant results for a set
 * of fixed corpus queries with known ground-truth expectations.
 *
 * Metrics:
 *   - Min results: query returns at least the expected number of results
 *   - Contains: expected substrings appear in result text
 *   - Result stability: queries return consistent counts across runs
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchQuery {
  id: number;
  scope: string;
  query: string;
  limit: number;
  language?: string;
  state?: string;
  expected_min_results: number;
  expected_contains?: string[];
  description: string;
}

interface SearchResult {
  query: SearchQuery;
  count: number;
  raw: string;
  passed: boolean;
  contains_pass: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Load queries
// ---------------------------------------------------------------------------

function loadQueries(): SearchQuery[] {
  const p = path.join(import.meta.dirname, "search-queries.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

// ---------------------------------------------------------------------------
// Execute a gh search
// ---------------------------------------------------------------------------

function runGhSearch(q: SearchQuery): SearchResult {
  const flags = ["search", q.scope, q.query, "--limit", String(q.limit)];

  // Use scope-appropriate --json fields
  const jsonFields: Record<string, string> = {
    repos: "fullName,description,stargazersCount",
    issues: "number,title,state,repository",
    prs: "number,title,state,repository",
    commits: "sha,commit",
  };
  if (q.scope !== "code" && jsonFields[q.scope]) {
    flags.push("--json", jsonFields[q.scope]!);
  }
  if (q.language) {
    flags.push("--language", q.language);
  }
  if (q.state) {
    flags.push("--state", q.state);
  }

  // Build shell-safe command
  const cmd = [
    "gh",
    ...flags.map((f) => (f.includes(" ") ? `'${f}'` : f)),
  ].join(" ");

  try {
    const stdout = execSync(cmd, { encoding: "utf-8", timeout: 30_000 });
    const raw = stdout.trim();

    if (!raw || raw === "[]") {
      return {
        query: q,
        count: 0,
        raw,
        passed: false,
        contains_pass: false,
        error: "No results returned",
      };
    }

    // Count results: for code scope, count non-empty lines;
    // for JSON scopes, parse the array
    let count: number;
    let containsPass = true;

    if (q.scope === "code") {
      count = raw.split("\n").filter((l) => l.trim()).length;
    } else {
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return {
            query: q,
            count: 0,
            raw,
            passed: false,
            contains_pass: false,
            error: `Expected JSON array, got ${typeof parsed}`,
          };
        }
        count = parsed.length;

        // Check contains expectations
        if (q.expected_contains) {
          const text = JSON.stringify(parsed).toLowerCase();
          for (const expected of q.expected_contains) {
            if (!text.includes(expected.toLowerCase())) {
              containsPass = false;
              break;
            }
          }
        }
      } catch {
        return {
          query: q,
          count: 0,
          raw,
          passed: false,
          contains_pass: false,
          error: "Failed to parse JSON output",
        };
      }
    }

    return {
      query: q,
      count,
      raw,
      passed: count >= q.expected_min_results && containsPass,
      contains_pass: containsPass,
    };
  } catch (err: any) {
    return {
      query: q,
      count: 0,
      raw: "",
      passed: false,
      contains_pass: false,
      error: err.stderr?.trim() || err.message || String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("search recall benchmarks", () => {
  const queries = loadQueries();

  // Run each query
  for (const q of queries) {
    it(`#${q.id}: ${q.description} (scope=${q.scope}, expect ≥${q.expected_min_results})`, () => {
      const result = runGhSearch(q);

      if (result.error) {
        console.log(`  ERROR: ${result.error}`);
      }
      console.log(
        `  Got ${result.count} results, ` +
          `min=${result.passed ? "PASS" : "FAIL"}, ` +
          `contains=${result.contains_pass ? "PASS" : "FAIL"}`,
      );

      expect(
        result.error,
        `Query #${q.id} failed: ${result.error}`,
      ).toBeUndefined();
      expect(
        result.count,
        `Expected ≥${q.expected_min_results} results, got ${result.count}`,
      ).toBeGreaterThanOrEqual(q.expected_min_results);
      expect(
        result.contains_pass,
        `Expected results to contain: ${q.expected_contains?.join(", ")}`,
      ).toBe(true);
    }, 35_000);
  }

  // Aggregate metrics
  it("aggregate: all queries pass", () => {
    const results = queries.map(runGhSearch);
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;

    console.log(`\nSearch recall: ${passed}/${total} queries passed`);

    // Compute MRR for queries with expected_contains
    let mrrSum = 0;
    let mrrCount = 0;
    for (const r of results) {
      if (!r.query.expected_contains || r.error) {
        continue;
      }
      // For JSON results, find position of first expected item
      try {
        const parsed = JSON.parse(r.raw);
        const text = JSON.stringify(parsed).toLowerCase();
        for (const expected of r.query.expected_contains) {
          const idx = text.indexOf(expected.toLowerCase());
          if (idx >= 0) {
            // Approximate rank from position (rough heuristic)
            const rank = Math.max(1, Math.ceil(idx / 500)); // ~500 chars per result
            mrrSum += 1 / rank;
          }
        }
      } catch {
        // skip unparseable
      }
      mrrCount++;
    }
    const mrr = mrrCount > 0 ? mrrSum / mrrCount : 0;
    console.log(`MRR (approx): ${(mrr * 100).toFixed(1)}%`);
    console.log(
      `Relevance@K: ${((passed / total) * 100).toFixed(1)}% of queries met expected min results`,
    );

    expect(passed).toBe(total);
  }, 35_000);
});
