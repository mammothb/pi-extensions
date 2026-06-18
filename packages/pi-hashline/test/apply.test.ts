import { beforeEach, describe, expect, it } from "vitest";

import { applyEdits } from "../src/apply";
import type { Anchor, Cursor, Edit } from "../src/types";

// ─── Edit constructors ───────────────────────────────────────────────

let _idx = 0;
function nextIdx(): number {
  return _idx++;
}

function ins(
  text: string,
  cursor: Cursor,
  lineNum = 1,
  mode?: "replacement",
): Edit {
  return {
    kind: "insert",
    cursor,
    text,
    lineNum,
    index: nextIdx(),
    ...(mode !== undefined ? { mode } : {}),
  };
}

function del(anchor: Anchor, lineNum = 1): Edit {
  return { kind: "delete", anchor, lineNum, index: nextIdx() };
}

function anc(line: number): Anchor {
  return { line };
}

function replaceRange(
  start: number,
  end: number,
  payloads: string[],
  lineNum = 1,
): Edit[] {
  const edits: Edit[] = [];
  for (const text of payloads) {
    edits.push(
      ins(
        text,
        { kind: "before_anchor", anchor: anc(start) },
        lineNum,
        "replacement",
      ),
    );
  }
  for (let line = start; line <= end; line++) {
    edits.push(del(anc(line), lineNum));
  }
  return edits;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("applyEdits", () => {
  beforeEach(() => {
    _idx = 0;
  });

  describe("replace", () => {
    it("replaces a single line with one line", () => {
      const result = applyEdits("a\nb\nc\n", replaceRange(2, 2, ["X"]));
      expect(result.text).toBe("a\nX\nc\n");
      expect(result.firstChangedLine).toBe(2);
    });

    it("replaces a single line with multiple lines", () => {
      const result = applyEdits("a\nb\nc\n", replaceRange(2, 2, ["X", "Y"]));
      expect(result.text).toBe("a\nX\nY\nc\n");
      expect(result.firstChangedLine).toBe(2);
    });

    it("replaces multiple lines with one line", () => {
      const result = applyEdits("a\nb\nc\nd\n", replaceRange(2, 3, ["X"]));
      expect(result.text).toBe("a\nX\nd\n");
    });

    it("replaces multiple lines with multiple lines", () => {
      const result = applyEdits(
        "a\nb\nc\nd\ne\n",
        replaceRange(2, 4, ["X", "Y"]),
      );
      expect(result.text).toBe("a\nX\nY\ne\n");
    });

    it("replaces first line", () => {
      const result = applyEdits("a\nb\nc\n", replaceRange(1, 1, ["X"]));
      expect(result.text).toBe("X\nb\nc\n");
      expect(result.firstChangedLine).toBe(1);
    });

    it("replaces last line", () => {
      const result = applyEdits("a\nb\nc\n", replaceRange(3, 3, ["X"]));
      expect(result.text).toBe("a\nb\nX\n");
    });

    it("replaces entire file", () => {
      const result = applyEdits("a\nb\n", replaceRange(1, 2, ["X"]));
      expect(result.text).toBe("X\n");
    });
  });

  describe("delete", () => {
    it("deletes a single line", () => {
      const result = applyEdits("a\nb\nc\n", [del(anc(2))]);
      expect(result.text).toBe("a\nc\n");
      expect(result.firstChangedLine).toBe(2);
    });

    it("deletes multiple lines", () => {
      const result = applyEdits("a\nb\nc\nd\ne\n", [
        del(anc(2)),
        del(anc(3)),
        del(anc(4)),
      ]);
      expect(result.text).toBe("a\ne\n");
    });

    it("deletes first line", () => {
      const result = applyEdits("a\nb\n", [del(anc(1))]);
      expect(result.text).toBe("b\n");
      expect(result.firstChangedLine).toBe(1);
    });

    it("deletes last line", () => {
      const result = applyEdits("a\nb\nc\n", [del(anc(3))]);
      expect(result.text).toBe("a\nb\n");
    });

    it("deletes all lines", () => {
      const result = applyEdits("a\nb\n", [del(anc(1)), del(anc(2))]);
      // Two deletes on 2-line file → empty (no lines, but the split gives [""])
      // Actually: "a\nb\n".split("\n") = ["a", "b", ""]
      // Deleting line 1 → ["b", ""], deleting line 2 → [""]
      expect(result.text).toBe("");
    });
  });

  describe("insert before", () => {
    it("inserts before a line", () => {
      const result = applyEdits("a\nb\nc\n", [
        ins("X", { kind: "before_anchor", anchor: anc(2) }),
      ]);
      expect(result.text).toBe("a\nX\nb\nc\n");
    });

    it("inserts before the first line", () => {
      const result = applyEdits("a\nb\n", [
        ins("X", { kind: "before_anchor", anchor: anc(1) }),
      ]);
      expect(result.text).toBe("X\na\nb\n");
      expect(result.firstChangedLine).toBe(1);
    });
  });

  describe("insert after", () => {
    it("inserts after a line", () => {
      const result = applyEdits("a\nb\nc\n", [
        ins("X", { kind: "after_anchor", anchor: anc(2) }),
      ]);
      expect(result.text).toBe("a\nb\nX\nc\n");
    });

    it("inserts after the last line", () => {
      const result = applyEdits("a\nb\n", [
        ins("X", { kind: "after_anchor", anchor: anc(2) }),
      ]);
      expect(result.text).toBe("a\nb\nX\n");
    });
  });

  describe("insert head", () => {
    it("prepends lines", () => {
      const result = applyEdits("a\nb\n", [ins("X", { kind: "bof" })]);
      expect(result.text).toBe("X\na\nb\n");
      expect(result.firstChangedLine).toBe(1);
    });

    it("prepends multiple lines", () => {
      const result = applyEdits("a\nb\n", [
        ins("X", { kind: "bof" }),
        ins("Y", { kind: "bof" }),
      ]);
      expect(result.text).toBe("X\nY\na\nb\n");
    });
  });

  describe("insert tail", () => {
    it("appends lines to end", () => {
      const result = applyEdits("a\nb\n", [ins("X", { kind: "eof" })]);
      // "a\nb\n".split("\n") = ["a", "b", ""]
      // Insert before trailing "" → ["a", "b", "X", ""]
      expect(result.text).toBe("a\nb\nX\n");
    });

    it("appends multiple lines", () => {
      const result = applyEdits("a\nb\n", [
        ins("X", { kind: "eof" }),
        ins("Y", { kind: "eof" }),
      ]);
      expect(result.text).toBe("a\nb\nX\nY\n");
    });

    it("appends to empty file", () => {
      const result = applyEdits("", [ins("X", { kind: "eof" })]);
      expect(result.text).toBe("X");
    });
  });

  describe("compound edits", () => {
    it("replaces and inserts on different lines", () => {
      const edits: Edit[] = [
        ...replaceRange(1, 1, ["HEADER"]),
        ins("MID", { kind: "before_anchor", anchor: anc(3) }),
        ins("FOOTER", { kind: "eof" }),
      ];
      const result = applyEdits("a\nb\nc\n", edits);
      expect(result.text).toBe("HEADER\nb\nMID\nc\nFOOTER\n");
    });

    it("deletes don't shift insert anchors", () => {
      // Delete line 5 first, but insert after line 3 — anchors are pre-edit
      const edits: Edit[] = [
        del(anc(5)),
        ins("NEW", { kind: "after_anchor", anchor: anc(3) }),
      ];
      const result = applyEdits("1\n2\n3\n4\n5\n6\n", edits);
      // After delete 5: ["1","2","3","4","6",""]
      // Insert after 3: ["1","2","3","NEW","4","6",""]
      expect(result.text).toBe("1\n2\n3\nNEW\n4\n6\n");
    });
  });

  describe("replacement + insert at same anchor", () => {
    it("replacement body comes before after_anchor inserts", () => {
      // replace line 2 + insert after line 2
      const edits: Edit[] = [
        ...replaceRange(2, 2, ["REPLACED"]),
        ins("AFTER", { kind: "after_anchor", anchor: anc(2) }),
      ];
      // Pre-edit: a\nb\nc\n
      // Replace 2 with REPLACED (deletes "b")
      // Insert AFTER after line 2
      // Result: a\nREPLACED\nAFTER\nc\n
      const result = applyEdits("a\nb\nc\n", edits);
      expect(result.text).toBe("a\nREPLACED\nAFTER\nc\n");
    });

    it("before_anchor inserts come before replacement body", () => {
      const edits: Edit[] = [
        ins("BEFORE", { kind: "before_anchor", anchor: anc(2) }),
        ...replaceRange(2, 2, ["REPLACED"]),
      ];
      const result = applyEdits("a\nb\nc\n", edits);
      expect(result.text).toBe("a\nBEFORE\nREPLACED\nc\n");
    });
  });

  describe("edge cases", () => {
    it("out-of-range line throws", () => {
      expect(() => applyEdits("a\nb\n", [del(anc(5))])).toThrow(
        /Line 5 does not exist/,
      );
    });

    it("out-of-range insert before throws", () => {
      expect(() =>
        applyEdits("a\nb\n", [
          ins("X", { kind: "before_anchor", anchor: anc(10) }),
        ]),
      ).toThrow(/Line 10 does not exist/);
    });

    it("line 0 throws", () => {
      expect(() => applyEdits("a\nb\n", [del(anc(0))])).toThrow(
        /Line 0 does not exist/,
      );
    });

    it("no-op on empty edit list", () => {
      const result = applyEdits("hello\n", []);
      expect(result.text).toBe("hello\n");
      expect(result.firstChangedLine).toBeUndefined();
    });

    it("block edit throws internal error", () => {
      expect(() =>
        applyEdits("hello\n", [
          {
            kind: "block",
            anchor: anc(1),
            payloads: ["new"],
            lineNum: 1,
            index: 0,
          },
        ]),
      ).toThrow(/unresolved.*block/);
    });

    it("firstChangedLine tracks earliest change", () => {
      const edits = [del(anc(3)), del(anc(1))];
      const result = applyEdits("a\nb\nc\nd\n", edits);
      expect(result.firstChangedLine).toBe(1);
    });

    it("handles empty file (only trailing newline)", () => {
      // "".split("\n") = [""]
      const result = applyEdits("", [ins("hello", { kind: "eof" })]);
      expect(result.text).toBe("hello");
      expect(result.firstChangedLine).toBe(1);
    });

    it("works with no trailing newline", () => {
      const result = applyEdits("a\nb\nc", replaceRange(2, 2, ["X"]));
      expect(result.text).toBe("a\nX\nc");
    });
  });
});
