import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { aggregate, StatsTracker, type UsageRecord } from "../src/tracker.js";

const TEST_LOG = path.join(os.tmpdir(), "pi-stats-test.jsonl");

function cleanLog() {
  try {
    fs.unlinkSync(TEST_LOG);
  } catch {
    // ok
  }
}

afterEach(cleanLog);

describe("StatsTracker", () => {
  it("starts with empty stats when no log exists", () => {
    cleanLog();
    const tracker = new StatsTracker(TEST_LOG);
    expect(tracker.getStats()).toEqual({ extensions: {} });
  });

  it("records extension usage across sessions", () => {
    cleanLog();
    const tracker = new StatsTracker(TEST_LOG);
    tracker.recordExtension("@mammothb/pi-mermaid", "tool", "session-1");
    tracker.recordExtension("@mammothb/pi-mermaid", "tool", "session-1");
    tracker.recordExtension("@mammothb/pi-ghsearch", "ext-cmd", "session-2");

    // Same tracker instance reads its own writes
    expect(tracker.getStats().extensions).toEqual({
      "@mammothb/pi-mermaid": 2,
      "@mammothb/pi-ghsearch": 1,
    });

    // New tracker instance reads same file
    const tracker2 = new StatsTracker(TEST_LOG);
    expect(tracker2.getStats().extensions).toEqual({
      "@mammothb/pi-mermaid": 2,
      "@mammothb/pi-ghsearch": 1,
    });
  });

  it("resets all stats", () => {
    cleanLog();
    const tracker = new StatsTracker(TEST_LOG);
    tracker.recordExtension("@mammothb/pi-mermaid", "tool", "s1");
    tracker.reset();
    expect(tracker.getStats()).toEqual({ extensions: {} });
  });

  it("getStats returns a copy, not a reference", () => {
    cleanLog();
    const tracker = new StatsTracker(TEST_LOG);
    tracker.recordExtension("@mammothb/pi-mermaid", "tool", "s1");
    const stats = tracker.getStats();
    stats.extensions["@mammothb/pi-mermaid"] = 999;
    expect(tracker.getStats().extensions["@mammothb/pi-mermaid"]).toBe(1);
  });

  it("getStats filters by sinceMs", () => {
    cleanLog();
    const tracker = new StatsTracker(TEST_LOG);
    // Write records with known timestamps directly
    const now = Date.now();
    fs.appendFileSync(
      TEST_LOG,
      `${JSON.stringify({ ts: now - 10000, ext: "old-ext", kind: "tool" as const })}\n`,
    );
    fs.appendFileSync(
      TEST_LOG,
      `${JSON.stringify({ ts: now - 1000, ext: "new-ext", kind: "tool" as const })}\n`,
    );

    const recent = tracker.getStats(now - 5000);
    expect(recent.extensions).toEqual({ "new-ext": 1 });
  });

  it("skips malformed lines in the log", () => {
    cleanLog();
    fs.appendFileSync(TEST_LOG, "not-json\n");
    fs.appendFileSync(
      TEST_LOG,
      `${JSON.stringify({ ts: 1, ext: "good", kind: "tool" })}\n`,
    );
    fs.appendFileSync(TEST_LOG, "\n"); // blank line
    const tracker = new StatsTracker(TEST_LOG);
    expect(tracker.getStats().extensions).toEqual({ good: 1 });
  });
});

describe("aggregate", () => {
  it("groups records by extension name", () => {
    const records: UsageRecord[] = [
      { ts: 1, ext: "ext-a", kind: "tool" },
      { ts: 2, ext: "ext-a", kind: "ext-cmd" },
      { ts: 3, ext: "ext-b", kind: "tool" },
    ];
    expect(aggregate(records)).toEqual({
      extensions: { "ext-a": 2, "ext-b": 1 },
    });
  });

  it("returns empty for no records", () => {
    expect(aggregate([])).toEqual({ extensions: {} });
  });
});
