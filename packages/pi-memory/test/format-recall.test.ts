import { describe, expect, it } from "vitest";
import { formatRecallOutput } from "../src/lib/recall/format-recall";
import type { RenderedEntry } from "../src/lib/recall/render-entries";

describe("formatRecallOutput", () => {
  it("shows no-match message with query", () => {
    const r = formatRecallOutput([], "xyz");
    expect(r).toContain('No matches for "xyz"');
  });

  it("shows no-entries message without query", () => {
    expect(formatRecallOutput([])).toContain("No entries");
  });

  it("formats entries with index and role", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "hello" },
    ];
    const r = formatRecallOutput(entries);
    expect(r).toContain("#0 [user] hello");
  });

  it("shows match count with query", () => {
    const entries: RenderedEntry[] = [
      { index: 2, role: "assistant", summary: "done" },
    ];
    const r = formatRecallOutput(entries, "done");
    expect(r).toContain('Found 1 matches for "done"');
  });

  it("uses headerOverride when provided", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "user", summary: "hello" },
    ];
    const r = formatRecallOutput(entries, "test", "Branch results");
    expect(r).toContain('Branch results for "test":');
    expect(r).not.toContain("Found");
  });

  it("shows files suffix when entry has files", () => {
    const entries: RenderedEntry[] = [
      { index: 0, role: "assistant", summary: "done", files: ["a.ts", "b.ts"] },
    ];
    const r = formatRecallOutput(entries);
    expect(r).toContain("files:[a.ts, b.ts]");
  });

  it("uses snippet instead of summary when query and snippet present", () => {
    const entries: any[] = [
      {
        index: 0,
        role: "user",
        summary: "long summary",
        snippet: "matched... here",
      },
    ];
    const r = formatRecallOutput(entries, "matched");
    expect(r).toContain("matched... here");
    expect(r).not.toContain("long summary");
  });
});
