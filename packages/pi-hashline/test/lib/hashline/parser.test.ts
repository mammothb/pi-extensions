import { describe, expect, it } from "vitest";

import { parsePatch } from "../../../src/lib/hashline/parser.js";
import type { Edit } from "../../../src/lib/hashline/types.js";

function collectKinds(edits: Edit[]): string[] {
  return edits.map((e) => e.kind);
}

describe("parsePatch", () => {
  describe("replace", () => {
    it("parses single-line replace", () => {
      const { edits, warnings } = parsePatch("replace 1..1:\n+new line\n");
      expect(warnings).toHaveLength(0);
      // One insert (replacement) + one delete
      expect(edits).toHaveLength(2);
      expect(edits[0]!.kind).toBe("insert");
      if (edits[0]!.kind === "insert") {
        expect(edits[0]!.text).toBe("new line");
        expect(edits[0]!.mode).toBe("replacement");
        expect(edits[0]!.cursor.kind).toBe("before_anchor");
        if (edits[0]!.cursor.kind === "before_anchor") {
          expect(edits[0]!.cursor.anchor.line).toBe(1);
        }
      }
      expect(edits[1]!.kind).toBe("delete");
      if (edits[1]!.kind === "delete") {
        expect(edits[1]!.anchor.line).toBe(1);
      }
    });

    it("parses multi-line replace with multi-line body", () => {
      const { edits } = parsePatch("replace 2..3:\n+foo\n+bar\n");
      // 2 inserts (replacement) + 2 deletes
      expect(edits).toHaveLength(4);
      expect(edits[0]!.kind).toBe("insert");
      expect(edits[1]!.kind).toBe("insert");
      expect(edits[2]!.kind).toBe("delete");
      expect(edits[3]!.kind).toBe("delete");
    });

    it("replace with empty body throws", () => {
      expect(() => parsePatch("replace 1..1:\n")).toThrow(
        /needs at least one.*body row/,
      );
    });

    it("replace with ranged delete (backwards range) throws", () => {
      expect(() => parsePatch("replace 5..3:\n+text\n")).toThrow(
        /ends before it starts/,
      );
    });
  });

  describe("delete", () => {
    it("parses single-line delete", () => {
      const { edits, warnings } = parsePatch("delete 3\n");
      expect(warnings).toHaveLength(0);
      expect(edits).toHaveLength(1);
      expect(edits[0]!.kind).toBe("delete");
      if (edits[0]!.kind === "delete") {
        expect(edits[0]!.anchor.line).toBe(3);
      }
    });

    it("parses range delete", () => {
      const { edits } = parsePatch("delete 3..5\n");
      expect(edits).toHaveLength(3); // lines 3,4,5
      expect(collectKinds(edits)).toEqual(["delete", "delete", "delete"]);
    });

    it("delete with body throws", () => {
      expect(() => parsePatch("delete 3\n+oops\n")).toThrow(
        /does not take body rows/,
      );
    });
  });

  describe("insert", () => {
    it("insert before N:", () => {
      const { edits } = parsePatch("insert before 3:\n+new line\n");
      expect(edits).toHaveLength(1);
      expect(edits[0]!.kind).toBe("insert");
      if (edits[0]!.kind === "insert") {
        expect(edits[0]!.cursor.kind).toBe("before_anchor");
        if (edits[0]!.cursor.kind === "before_anchor") {
          expect(edits[0]!.cursor.anchor.line).toBe(3);
        }
        expect(edits[0]!.mode).toBeUndefined();
      }
    });

    it("insert after N:", () => {
      const { edits } = parsePatch("insert after 5:\n+new line\n");
      expect(edits).toHaveLength(1);
      expect(edits[0]!.kind).toBe("insert");
      if (edits[0]!.kind === "insert") {
        expect(edits[0]!.cursor.kind).toBe("after_anchor");
        if (edits[0]!.cursor.kind === "after_anchor") {
          expect(edits[0]!.cursor.anchor.line).toBe(5);
        }
      }
    });

    it("insert head:", () => {
      const { edits } = parsePatch("insert head:\n+first\n");
      expect(edits).toHaveLength(1);
      expect(edits[0]!.kind).toBe("insert");
      if (edits[0]!.kind === "insert") {
        expect(edits[0]!.cursor.kind).toBe("bof");
      }
    });

    it("insert tail:", () => {
      const { edits } = parsePatch("insert tail:\n+last\n");
      expect(edits).toHaveLength(1);
      expect(edits[0]!.kind).toBe("insert");
      if (edits[0]!.kind === "insert") {
        expect(edits[0]!.cursor.kind).toBe("eof");
      }
    });

    it("insert with empty body throws", () => {
      expect(() => parsePatch("insert head:\n")).toThrow(/needs at least one/);
    });
  });

  describe("block ops", () => {
    it("replace block N: produces a block edit", () => {
      const { edits } = parsePatch("replace block 3:\n+new body\n");
      expect(edits).toHaveLength(1);
      expect(edits[0]!.kind).toBe("block");
      if (edits[0]!.kind === "block") {
        expect(edits[0]!.anchor.line).toBe(3);
        expect(edits[0]!.payloads).toEqual(["new body"]);
      }
    });

    it("delete block N produces a block delete edit", () => {
      const { edits } = parsePatch("delete block 5\n");
      expect(edits).toHaveLength(1);
      expect(edits[0]!.kind).toBe("block");
      if (edits[0]!.kind === "block") {
        expect(edits[0]!.anchor.line).toBe(5);
        expect(edits[0]!.payloads).toEqual([]);
      }
    });

    it("replace block N: with empty body throws", () => {
      expect(() => parsePatch("replace block 3:\n")).toThrow(
        /needs at least one.*body row/,
      );
    });

    it("delete block N with body throws", () => {
      expect(() => parsePatch("delete block 3\n+oops\n")).toThrow(
        /does not take body rows/,
      );
    });
  });

  describe("bare body rows (rejected)", () => {
    it("unprefixed body rows throw", () => {
      expect(() => parsePatch("replace 1..1:\nraw text\n")).toThrow(
        /Bare body row/,
      );
    });

    it("minus rows are rejected", () => {
      expect(() => parsePatch("replace 1..1:\n-removed\n")).toThrow(
        /rows are not valid/,
      );
    });
  });

  describe("body rows without header", () => {
    it("throws on payload without preceding hunk header", () => {
      expect(() => parsePatch("+orphan\n")).toThrow(/no preceding hunk header/);
    });

    it("throws on raw text without preceding hunk header", () => {
      expect(() => parsePatch("orphan\n")).toThrow(/no preceding hunk header/);
    });
  });

  describe("envelope and abort markers", () => {
    it("*** Begin Patch is silently consumed", () => {
      const { edits } = parsePatch("replace 1..1:\n+line\n*** Begin Patch\n");
      expect(edits).toHaveLength(2);
    });
    it("*** End Patch stops parsing", () => {
      const { edits } = parsePatch(
        "replace 1..1:\n+line\n*** End Patch\n+ignored\n",
      );
      // +ignored is after *** End Patch so dropped
      expect(edits).toHaveLength(2);
    });

    it("--- is rejected as bare body row (MINUS_ROW_REJECTED)", () => {
      expect(() => parsePatch("replace 1..1:\n---\n")).toThrow(
        /rows are not valid/,
      );
    });

    it("*** Abort stops parsing", () => {
      const { edits } = parsePatch(
        "replace 1..1:\n+line\n*** Abort\n+ignored\n",
      );
      expect(edits).toHaveLength(2);
    });
  });

  describe("multiple ops", () => {
    it("adjacent + rows produce separate insert edits", () => {
      const { edits } = parsePatch("replace 1..1:\n+line1\n+line2\n+line3\n");
      expect(edits).toHaveLength(4); // 3 inserts + 1 delete
      const inserts = edits.filter((e) => e.kind === "insert");
      expect(inserts).toHaveLength(3);
    });

    it("multiple hunks in sequence", () => {
      const { edits } = parsePatch(
        "replace 1..1:\n+first\ninsert before 3:\n+second\n",
      );
      expect(edits).toHaveLength(3); // insert+delete for replace, insert for before
    });
  });

  describe("overlapping deletes", () => {
    it("rejects duplicate delete anchors", () => {
      expect(() => parsePatch("delete 3\ndelete 3\n")).toThrow(
        /already targeted/,
      );
    });

    it("rejects overlapping delete from replace + delete", () => {
      expect(() => parsePatch("replace 3..5:\n+x\n+y\n+z\ndelete 3\n")).toThrow(
        /already targeted/,
      );
    });
  });

  describe("warnings", () => {
    it("returns empty warnings for clean input", () => {
      const { warnings } = parsePatch("replace 1..1:\n+clean\n");
      expect(warnings).toHaveLength(0);
    });

    it("throws on bare body rows", () => {
      expect(() => parsePatch("replace 1..1:\nbare1\n")).toThrow(
        /Bare body row/,
      );
    });
  });
});
