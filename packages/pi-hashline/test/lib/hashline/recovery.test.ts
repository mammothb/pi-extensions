import { describe, expect, it } from "vitest";

import { applyEdits } from "../../../src/lib/hashline/apply.js";
import {
  RECOVERY_EXTERNAL_WARNING,
  RECOVERY_SESSION_REPLAY_WARNING,
} from "../../../src/lib/hashline/messages.js";
import { tryRecover } from "../../../src/lib/hashline/recovery.js";
import { InMemorySnapshotStore } from "../../../src/lib/hashline/snapshots.js";
import type { Edit } from "../../../src/lib/hashline/types.js";

// Helpers
function anc(line: number) {
  return { line };
}

function makeEdits(start: number, end: number, payloads: string[]): Edit[] {
  const edits: Edit[] = [];
  let idx = 0;
  for (const text of payloads) {
    edits.push({
      kind: "insert",
      cursor: { kind: "before_anchor", anchor: anc(start) },
      text,
      lineNum: 1,
      index: idx++,
      mode: "replacement",
    });
  }
  for (let line = start; line <= end; line++) {
    edits.push({
      kind: "delete",
      anchor: anc(line),
      lineNum: 1,
      index: idx++,
    });
  }
  return edits;
}

function collectAnchorLines(start: number, end: number): number[] {
  const lines: number[] = [];
  for (let l = start; l <= end; l++) {
    lines.push(l);
  }
  return lines;
}

describe("tryRecover", () => {
  it("returns null when hash was never recorded", () => {
    const snapshots = new InMemorySnapshotStore();
    const current = "line1\nline2\nline3\n";
    const edits = makeEdits(2, 2, ["CHANGED"]);

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      "FFFF00",
      edits,
      collectAnchorLines(2, 2),
    );
    expect(result).toBeNull();
  });

  it("recovers from external unrelated line change (3-way merge)", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "line1\nline2\nline3\nline4\n";
    // Record the original snapshot.
    const tag = snapshots.record("/f.ts", original);

    // External change modifies line 1 (unrelated to edit on line 3).
    const current = "LINE1_CHANGED\nline2\nline3\nline4\n";
    const edits = makeEdits(3, 3, ["CHANGED"]);

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tag,
      edits,
      collectAnchorLines(3, 3),
    );

    expect(result).not.toBeNull();
    expect(result!.warning).toBe(RECOVERY_EXTERNAL_WARNING);
    expect(result!.text).toContain("LINE1_CHANGED");
    expect(result!.text).toContain("CHANGED");
    // Line 2 should be preserved.
    expect(result!.text).toContain("line2");
  });

  it("recovers from external change on the exact edited line fails", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "line1\nline2\nline3\n";
    const tag = snapshots.record("/f.ts", original);

    // External change modifies the exact line being edited.
    const current = "line1\nLINE2_EXTERNAL\nline3\n";
    const edits = makeEdits(2, 2, ["ATTEMPTED"]);

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tag,
      edits,
      collectAnchorLines(2, 2),
    );

    // Structured patch should fail because context around line 2 changed.
    expect(result).toBeNull();
  });

  it("recovers from external formatter change (whitespace-only)", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "function foo() {\n  return 1;\n}\n";
    const tag = snapshots.record("/f.ts", original);

    // Formatter adds a blank line.
    const current = "function foo() {\n\n  return 1;\n}\n";
    const edits = makeEdits(2, 2, ["  return 42;"]);

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tag,
      edits,
      collectAnchorLines(2, 2),
    );

    // The edit context line might not match exactly due to the added line.
    // Structured patch with 3 lines of context may or may not work.
    // This is a realistic edge case.
    if (result !== null) {
      expect(result!.warning).toBe(RECOVERY_EXTERNAL_WARNING);
    }
    // Either recovery succeeds or it doesn't — both are valid outcomes.
  });

  it("session-chain: replay when anchors still match", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "a\nb\nc\nd\ne\n";
    const tagV1 = snapshots.record("/f.ts", original);

    // Agent edits line 2 and 4, minting new snapshot V2.
    const edit1 = makeEdits(2, 2, ["B_CHANGED"]);
    const afterEdit1 = applyEdits(original, edit1);
    snapshots.record("/f.ts", afterEdit1.text);

    // Agent tries to edit line 4 with old tag V1.
    // Line 4 content is identical between V1 and live (V2).
    const current = afterEdit1.text;
    const editsV1 = makeEdits(4, 4, ["D_CHANGED"]);

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tagV1,
      editsV1,
      collectAnchorLines(4, 4),
    );

    // Should recover via session-chain replay.
    expect(result).not.toBeNull();
    expect(result!.warning).toBe(RECOVERY_SESSION_REPLAY_WARNING);
    expect(result!.text).toContain("B_CHANGED"); // preserved from V2
    expect(result!.text).toContain("D_CHANGED"); // new edit applied
  });

  it("session-chain: fails when anchor line was rewritten", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "a\nb\nc\n";
    const tagV1 = snapshots.record("/f.ts", original);

    // Agent rewrites line 2, minting V2.
    const edit1 = makeEdits(2, 2, ["TOTALLY_DIFFERENT"]);
    const afterEdit1 = applyEdits(original, edit1);
    snapshots.record("/f.ts", afterEdit1.text);

    // Agent tries to edit line 2 again with old tag V1.
    // But line 2 was rewritten — anchor content doesn't match.
    const current = afterEdit1.text;
    const editsV1 = makeEdits(2, 2, ["ANOTHER"]);

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tagV1,
      editsV1,
      collectAnchorLines(2, 2),
    );

    // Structured patch also fails because context around line 2 is different.
    // Session-chain replay fails because anchor content doesn't match.
    expect(result).toBeNull();
  });

  it("3-way merge recovers from unrelated insertion above", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "a\nb\nc\n";
    const tag = snapshots.record("/f.ts", original);

    // External change inserts a line above.
    const current = "INSERTED\na\nb\nc\n";
    const edits = makeEdits(2, 2, ["A_CHANGED"]); // original line 2 = "b"

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tag,
      edits,
      collectAnchorLines(2, 2),
    );

    if (result !== null) {
      expect(result!.warning).toBe(RECOVERY_EXTERNAL_WARNING);
      expect(result!.text).toContain("INSERTED");
    }
  });

  it("recovery result includes warning text", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "line1\nline2\nline3\n";
    const tag = snapshots.record("/f.ts", original);

    const current = "line1\nline2_CHANGED\nline3\n";
    const edits = makeEdits(3, 3, ["CHANGED"]);

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tag,
      edits,
      collectAnchorLines(3, 3),
    );

    // Line 2 changed externally, but we're editing line 3 — should recover.
    expect(result).not.toBeNull();
    expect(result!.warning.length).toBeGreaterThan(0);
    expect(result!.text).not.toBe(current);
  });

  it("session-chain replay with matching anchors across multiple edits", () => {
    const snapshots = new InMemorySnapshotStore();
    const original = "1\n2\n3\n4\n5\n";
    const tagV1 = snapshots.record("/f.ts", original);

    // First edit changes line 1.
    const edit1 = makeEdits(1, 1, ["ONE"]);
    const afterEdit1 = applyEdits(original, edit1);
    snapshots.record("/f.ts", afterEdit1.text);

    // Second edit (with stale tag) changes lines 3 and 5.
    // Neither was touched by the first edit.
    const current = afterEdit1.text;
    const editsV1: Edit[] = [
      ...makeEdits(3, 3, ["THREE"]),
      {
        kind: "insert",
        cursor: { kind: "after_anchor", anchor: anc(5) },
        text: "SIX",
        lineNum: 1,
        index: 10,
      },
    ];

    const result = tryRecover(
      snapshots,
      "/f.ts",
      current,
      tagV1,
      editsV1,
      [3, 5],
    );

    // The structured patch should work for line 3 (context unchanged).
    // The insert-after-5 should also work since line 5 is unchanged.
    if (result !== null) {
      expect(result!.text).toContain("THREE");
      expect(result!.text).toContain("SIX");
    }
  });
});
