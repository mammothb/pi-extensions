import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregate,
  appendRecord,
  readRecords,
  StatsTracker,
  type UsageRecord,
} from "../src/tracker.js";

const TEST_LOG = path.join(os.tmpdir(), "pi-stats-test.jsonl");

function cleanLog() {
  try {
    fs.unlinkSync(TEST_LOG);
  } catch {
    // ok
  }
}

afterEach(cleanLog);

// ===========================================================================
// StatsTracker — basic operations
// ===========================================================================

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

  it("uses default LOG_FILE path when no argument", () => {
    // Constructor with no custom path should use the default
    const tracker = new StatsTracker();
    // Just verify it doesn't throw on construction
    expect(tracker).toBeDefined();
  });
});

// ===========================================================================
// StatsTracker — error resilience
// ===========================================================================

describe("StatsTracker — error resilience", () => {
  it("recordExtension survives unwritable directory", () => {
    const badPath = path.join(
      os.tmpdir(),
      "nonexistent-dir",
      "nested",
      "stats.jsonl",
    );
    const tracker = new StatsTracker(badPath);
    // Should not throw
    expect(() => tracker.recordExtension("ext", "tool")).not.toThrow();
  });

  it("getStats returns empty stats when file does not exist", () => {
    const nonexistent = path.join(os.tmpdir(), "does-not-exist.jsonl");
    const tracker = new StatsTracker(nonexistent);
    expect(tracker.getStats()).toEqual({ extensions: {} });
  });

  it("reset survives unwritable path", () => {
    const badPath = path.join(os.tmpdir(), "nonexistent-dir", "reset.jsonl");
    const tracker = new StatsTracker(badPath);
    // Should not throw
    expect(() => tracker.reset()).not.toThrow();
  });

  it("recordExtension without session works", () => {
    cleanLog();
    const tracker = new StatsTracker(TEST_LOG);
    tracker.recordExtension("ext-a", "tool"); // no session arg
    tracker.recordExtension("ext-a", "tool", undefined);
    expect(tracker.getStats().extensions).toEqual({ "ext-a": 2 });
  });
});

// ===========================================================================
// appendRecord / readRecords standalone functions
// ===========================================================================

describe("appendRecord", () => {
  const isolatedLog = path.join(os.tmpdir(), "pi-stats-append-test.jsonl");

  afterEach(() => {
    try {
      fs.unlinkSync(isolatedLog);
    } catch {
      // ok
    }
  });

  it("writes a record to the isolated log file", () => {
    appendRecord({ ts: 1, ext: "test-ext", kind: "tool" }, isolatedLog);

    const content = fs.readFileSync(isolatedLog, "utf-8");
    expect(content).toContain('"ext":"test-ext"');
    expect(content).toContain('"kind":"tool"');
  });

  it("survives unwritable path without throwing", () => {
    expect(() =>
      appendRecord(
        { ts: 2, ext: "x", kind: "ext-cmd" },
        "/nonexistent/dir/stats.jsonl",
      ),
    ).not.toThrow();
  });
});

describe("readRecords", () => {
  const isolatedLog = path.join(os.tmpdir(), "pi-stats-read-test.jsonl");

  afterEach(() => {
    try {
      fs.unlinkSync(isolatedLog);
    } catch {
      // ok
    }
  });

  it("returns empty array when file does not exist", () => {
    const records = readRecords(undefined, isolatedLog);
    expect(records).toEqual([]);
  });

  it("reads records filtered by sinceMs", () => {
    const now = Date.now();
    fs.writeFileSync(
      isolatedLog,
      `${[
        JSON.stringify({ ts: now - 10000, ext: "old", kind: "tool" }),
        JSON.stringify({ ts: now - 1000, ext: "new", kind: "tool" }),
      ].join("\n")}\n`,
    );

    const recent = readRecords(now - 5000, isolatedLog);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.ext).toBe("new");
  });

  it("skips malformed lines", () => {
    fs.writeFileSync(
      isolatedLog,
      "not-json\n" +
        JSON.stringify({ ts: 1, ext: "good", kind: "tool" }) +
        "\n",
    );

    const records = readRecords(undefined, isolatedLog);
    expect(records).toHaveLength(1);
    expect(records[0]!.ext).toBe("good");
  });
});

// ===========================================================================
// aggregate
// ===========================================================================

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

  it("counts different kinds under same extension", () => {
    const records: UsageRecord[] = [
      { ts: 1, ext: "ext-a", kind: "tool" },
      { ts: 2, ext: "ext-a", kind: "ext-cmd" },
      { ts: 3, ext: "ext-a", kind: "tool" },
    ];
    expect(aggregate(records)).toEqual({
      extensions: { "ext-a": 3 },
    });
  });

  it("handles records with session field", () => {
    const records: UsageRecord[] = [
      { ts: 1, ext: "ext-a", kind: "tool", session: "abc" },
      { ts: 2, ext: "ext-a", kind: "tool", session: "def" },
    ];
    expect(aggregate(records)).toEqual({
      extensions: { "ext-a": 2 },
    });
  });
});
