import { describe, expect, it } from "vitest";

import {
  hasBlockEdit,
  resolveBlockEdits,
} from "../../../src/lib/hashline/block.js";
import type {
  BlockResolver,
  BlockResolverRequest,
  BlockSpan,
  Edit,
} from "../../../src/lib/hashline/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function anc(line: number) {
  return { line };
}

function block(line: number, payloads: string[], lineNum = 1, index = 0): Edit {
  return {
    kind: "block",
    anchor: anc(line),
    payloads,
    lineNum,
    index,
  };
}

function ins(
  text: string,
  anchor: number,
  lineNum = 1,
  mode?: "replacement",
): Edit {
  return {
    kind: "insert",
    cursor: { kind: "before_anchor", anchor: anc(anchor) },
    text,
    lineNum,
    index: 0, // index is renumbered by resolveBlockEdits
    ...(mode !== undefined ? { mode } : {}),
  };
}

function del(line: number, lineNum = 1): Edit {
  return {
    kind: "delete",
    anchor: anc(line),
    lineNum,
    index: 0,
  };
}

function mockResolver(map: Record<number, BlockSpan | null>): BlockResolver {
  return (req: BlockResolverRequest): BlockSpan | null => {
    const entry = map[req.line];
    if (entry === undefined) {
      return null;
    }
    return entry;
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("hasBlockEdit", () => {
  it("false for empty list", () => {
    expect(hasBlockEdit([])).toBe(false);
  });

  it("false for non-block edits only", () => {
    expect(hasBlockEdit([del(2), ins("a", 3)])).toBe(false);
  });

  it("true when at least one block edit exists", () => {
    expect(hasBlockEdit([del(2), block(1, ["x"])])).toBe(true);
  });

  it("true for delete block (empty payloads)", () => {
    expect(hasBlockEdit([block(1, [])])).toBe(true);
  });
});

describe("resolveBlockEdits", () => {
  it("identity fast path — no block edits", () => {
    const edits: Edit[] = [del(3), ins("x", 1)];
    const result = resolveBlockEdits(edits, "a\nb\nc\n", "/f.py", undefined);
    // Should return the same array (identity) when no block edits
    expect(result).toBe(edits);
  });

  it("empty edits — identity fast path", () => {
    const result = resolveBlockEdits([], "text", "/f.ts", undefined);
    expect(result).toStrictEqual([]);
  });

  describe("with mock resolver", () => {
    const text = "line1\nline2\nline3\nline4\nline5\n";
    const path = "/test/file.ts";

    it("expands block edit to inserts + deletes", () => {
      const resolver = mockResolver({ 2: { start: 2, end: 4 } });
      const edits: Edit[] = [block(2, ["NEW"], 1, 0)];

      const result = resolveBlockEdits(edits, text, path, resolver);

      // Expect: replacement insert at line 2, deletes for lines 2,3,4
      expect(result).toHaveLength(4); // 1 insert + 3 deletes
      expect(result[0]).toMatchObject({
        kind: "insert",
        cursor: { kind: "before_anchor", anchor: { line: 2 } },
        text: "NEW",
        mode: "replacement",
      });
      expect(result[1]).toMatchObject({ kind: "delete", anchor: { line: 2 } });
      expect(result[2]).toMatchObject({ kind: "delete", anchor: { line: 3 } });
      expect(result[3]).toMatchObject({ kind: "delete", anchor: { line: 4 } });
    });

    it("block delete (empty payloads) — pure deletes, no inserts", () => {
      const resolver = mockResolver({ 3: { start: 3, end: 3 } });
      const edits: Edit[] = [block(3, [], 1, 0)];

      const result = resolveBlockEdits(edits, text, path, resolver);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "delete",
        anchor: { line: 3 },
      });
    });

    it("multi-line block — correct number of deletes", () => {
      const resolver = mockResolver({ 1: { start: 1, end: 5 } });
      const edits: Edit[] = [block(1, ["A", "B"], 1, 0)];

      const result = resolveBlockEdits(edits, text, path, resolver);

      // 2 inserts + 5 deletes
      expect(result).toHaveLength(7);
      const inserts = result.filter((e) => e.kind === "insert");
      const deletes = result.filter((e) => e.kind === "delete");
      expect(inserts).toHaveLength(2);
      expect(deletes).toHaveLength(5);
    });

    it("mixed block + non-block edits — block resolved, others pass through", () => {
      const resolver = mockResolver({ 2: { start: 2, end: 2 } });
      const edits: Edit[] = [
        ins("before", 1, 1),
        block(2, ["REPLACED"], 2, 1),
        del(5, 3),
      ];

      const result = resolveBlockEdits(edits, text, path, resolver);

      // before insert (pass through) + replacement insert + delete line 2 + delete line 5
      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({
        kind: "insert",
        cursor: { kind: "before_anchor", anchor: { line: 1 } },
        text: "before",
      });
      expect(result[1]).toMatchObject({
        kind: "insert",
        cursor: { kind: "before_anchor", anchor: { line: 2 } },
        text: "REPLACED",
        mode: "replacement",
      });
      expect(result[2]).toMatchObject({ kind: "delete", anchor: { line: 2 } });
      expect(result[3]).toMatchObject({ kind: "delete", anchor: { line: 5 } });
    });

    it("renumbers indices sequentially", () => {
      const resolver = mockResolver({ 2: { start: 2, end: 3 } });
      const edits: Edit[] = [block(2, ["X", "Y"], 1, 99)];

      const result = resolveBlockEdits(edits, text, path, resolver);

      const indices = result.map((e) => e.index);
      expect(indices).toStrictEqual([0, 1, 2, 3]);
    });
  });

  describe("error handling", () => {
    const text = "line1\nline2\n";
    const path = "/f.py";

    it("throws when resolver returns null (default throw)", () => {
      const resolver = mockResolver({ 1: null });
      const edits: Edit[] = [block(1, ["x"])];

      expect(() => resolveBlockEdits(edits, text, path, resolver)).toThrow(
        /could not resolve a syntactic block/i,
      );
    });

    it("throws with line number in message", () => {
      const resolver = mockResolver({ 42: null });
      const edits: Edit[] = [block(42, ["x"])];

      expect(() => resolveBlockEdits(edits, text, path, resolver)).toThrow(
        /line 42/,
      );
    });

    it('drops block edit when resolver returns null and onUnresolved: "drop"', () => {
      const resolver = mockResolver({ 1: null });
      const edits: Edit[] = [block(1, ["x"])];

      const result = resolveBlockEdits(edits, text, path, resolver, {
        onUnresolved: "drop",
      });

      // Block edit dropped, no edits remain
      expect(result).toHaveLength(0);
    });

    it("throws with BLOCK_RESOLVER_UNAVAILABLE when resolver is undefined", () => {
      const edits: Edit[] = [block(1, ["x"])];

      expect(() => resolveBlockEdits(edits, text, path, undefined)).toThrow(
        /no block resolver configured/,
      );
    });

    it('drops block edit when resolver is undefined and onUnresolved: "drop"', () => {
      const edits: Edit[] = [block(1, ["x"])];

      const result = resolveBlockEdits(edits, text, path, undefined, {
        onUnresolved: "drop",
      });

      expect(result).toHaveLength(0);
    });

    it('mixed — drops unresolved block but keeps non-block edits with onUnresolved: "drop"', () => {
      const resolver = mockResolver({ 1: null });
      const edits: Edit[] = [ins("keep", 3, 1), block(1, ["drop"], 2)];

      const result = resolveBlockEdits(edits, text, path, resolver, {
        onUnresolved: "drop",
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        kind: "insert",
        text: "keep",
      });
    });
  });

  describe("edge cases", () => {
    const text = "a\nb\nc\n";
    const path = "/f.ts";

    it("single-line block (span.start === span.end)", () => {
      const resolver = mockResolver({ 2: { start: 2, end: 2 } });
      const edits: Edit[] = [block(2, ["X"])];

      const result = resolveBlockEdits(edits, text, path, resolver);

      expect(result).toHaveLength(2); // 1 insert + 1 delete
      expect(result[0]).toMatchObject({
        kind: "insert",
        text: "X",
        mode: "replacement",
      });
      expect(result[1]).toMatchObject({
        kind: "delete",
        anchor: { line: 2 },
      });
    });

    it("multiple block edits all resolved", () => {
      const resolver = mockResolver({
        1: { start: 1, end: 1 },
        3: { start: 3, end: 4 },
      });
      const edits: Edit[] = [block(1, ["A"], 1), block(3, ["B"], 2)];

      const result = resolveBlockEdits(edits, text, path, resolver);

      // Block 1: 1 insert + 1 delete → 2 edits
      // Block 3: 1 insert + 2 deletes → 3 edits
      expect(result).toHaveLength(5);
    });

    it("large block span — all lines deleted", () => {
      const resolver = mockResolver({ 1: { start: 1, end: 100 } });
      const edits: Edit[] = [block(1, ["FULL REPLACE"])];

      const result = resolveBlockEdits(
        edits,
        "x".repeat(1000),
        "/f.ts",
        resolver,
      );

      expect(result).toHaveLength(101); // 1 insert + 100 deletes
    });
  });
});
