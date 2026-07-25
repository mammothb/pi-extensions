/**
 * Tests for concurrency limiter utility.
 *
 * Uses setTimeout-based async functions to simulate work with
 * measurable timing, verifying that concurrency limits are
 * enforced and abort signals propagate correctly.
 */

import { describe, expect, it } from "vitest";
import { mapWithConcurrencyLimit } from "../src/lib/concurrency.js";

/** Returns a promise that resolves with value after ms */
function delay<T>(ms: number, value: T, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError")); // NOSONAR
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError")); // NOSONAR
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    }, ms);
  });
}

describe("mapWithConcurrencyLimit", () => {
  it("processes a single item", async () => {
    const results = await mapWithConcurrencyLimit(["a"], 4, async (item) =>
      item.toUpperCase(),
    );
    expect(results).toEqual(["A"]);
  });

  it("processes multiple items and returns results in original order", async () => {
    // Items resolve out of order (first slow, second fast)
    const results = await mapWithConcurrencyLimit(
      [200, 50],
      4,
      async (ms, i) => {
        await delay(ms, ms);
        return i;
      },
    );
    // Results in original index order: index 0 first, index 1 second
    expect(results).toEqual([0, 1]);
  });

  it("runs concurrently when limit > 1 (faster than serial)", async () => {
    // 3 items each 100ms. Serial would take 300ms. Concurrent takes ~100ms.
    const started = Date.now();
    await mapWithConcurrencyLimit([100, 100, 100], 3, async (ms) =>
      delay(ms, ms),
    );
    const elapsed = Date.now() - started;
    // Allow generous margin for test runner overhead
    expect(elapsed).toBeLessThan(250);
  });

  it("enforces concurrency limit (serial when limit=1)", async () => {
    const started = Date.now();
    await mapWithConcurrencyLimit([80, 80, 80], 1, async (ms) => delay(ms, ms));
    const elapsed = Date.now() - started;
    // Serial: 3 × 80ms ≈ 240ms min
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it("enforces concurrency limit with 2 active at a time (6 items)", async () => {
    // Track how many are running simultaneously
    let running = 0;
    let maxRunning = 0;

    await mapWithConcurrencyLimit([40, 40, 40, 40, 40, 40], 2, async (ms) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await delay(ms, ms);
      running--;
      return ms;
    });

    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      mapWithConcurrencyLimit(
        [1, 2, 3],
        4,
        async (item) => item,
        controller.signal,
      ),
    ).rejects.toThrow("Aborted");
  });

  it("aborts in-flight and pending workers", async () => {
    const controller = new AbortController();
    let secondStarted = false;

    const promise = mapWithConcurrencyLimit(
      [200, 200, 200],
      2, // first 2 start, third pending
      async (ms, _i, signal) => {
        if (ms === 200 && !secondStarted) {
          secondStarted = true;
        }
        return delay(ms, ms, signal);
      },
      controller.signal,
    );

    // Abort after a short delay — first 2 workers in flight, third not started
    await delay(50, undefined);
    controller.abort();

    await expect(promise).rejects.toThrow("Aborted");
  });

  it("preserves sibling results when one worker throws", async () => {
    // Track independently-collected results to verify that completed
    // siblings survive when a later worker throws.
    const settled = new Map<number, string>();

    const promise = mapWithConcurrencyLimit(
      ["a", "b", "c"],
      2,
      async (item, index, _signal) => {
        if (item === "c") {
          throw new Error("worker error");
        }
        const result = `result-${item}`;
        settled.set(index, result);
        return result;
      },
    );

    await expect(promise).rejects.toThrow("worker error");
    // Items "a" and "b" completed before "c" threw
    expect(settled.has(0)).toBe(true);
    expect(settled.has(1)).toBe(true);
    // Item "c" never settled (it threw)
    expect(settled.has(2)).toBe(false);
  });
});
