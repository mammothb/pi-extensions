import { describe, expect, it } from "vitest";

import { Patch, PatchSection } from "../../../src/lib/hashline/input.js";

describe("PatchSection", () => {
  describe("parse", () => {
    it("parses a single section with replace", () => {
      const section = new PatchSection({
        path: "foo.ts",
        fileHash: "A1B2",
        diffLines: ["replace 1..1:", "+new line"],
      });

      const { edits } = section.parse();
      expect(edits).toHaveLength(2); // insert + delete
    });

    it("caches parse results", () => {
      const section = new PatchSection({
        path: "foo.ts",
        fileHash: "A1B2",
        diffLines: ["replace 1..1:", "+line"],
      });

      const r1 = section.parse();
      const r2 = section.parse();
      expect(r1).toBe(r2); // same object reference
    });

    it("edits getter returns parsed edits", () => {
      const section = new PatchSection({
        path: "foo.ts",
        fileHash: "A1B2",
        diffLines: ["delete 3"],
      });
      expect(section.edits).toHaveLength(1);
      expect(section.edits[0]!.kind).toBe("delete");
    });

    it("warnings getter returns parse warnings", () => {
      const section = new PatchSection({
        path: "foo.ts",
        fileHash: "A1B2",
        diffLines: ["replace 1..1:", "bare row"],
      });
      expect(
        section.warnings.some((w) => w.includes("Auto-prefixed bare body")),
      ).toBe(true);
    });
  });

  describe("hasAnchoredEdit", () => {
    it("true for replace", () => {
      const section = new PatchSection({
        path: "f",
        fileHash: "A1B2",
        diffLines: ["replace 1..1:", "+x"],
      });
      expect(section.hasAnchoredEdit).toBe(true);
    });

    it("true for delete", () => {
      const section = new PatchSection({
        path: "f",
        fileHash: "A1B2",
        diffLines: ["delete 3"],
      });
      expect(section.hasAnchoredEdit).toBe(true);
    });

    it("false for pure insert head", () => {
      const section = new PatchSection({
        path: "f",
        fileHash: "A1B2",
        diffLines: ["insert head:", "+x"],
      });
      expect(section.hasAnchoredEdit).toBe(false);
    });

    it("false for pure insert tail", () => {
      const section = new PatchSection({
        path: "f",
        fileHash: "A1B2",
        diffLines: ["insert tail:", "+x"],
      });
      expect(section.hasAnchoredEdit).toBe(false);
    });

    it("true for insert before", () => {
      const section = new PatchSection({
        path: "f",
        fileHash: "A1B2",
        diffLines: ["insert before 5:", "+x"],
      });
      expect(section.hasAnchoredEdit).toBe(true);
    });
  });

  describe("collectAnchorLines", () => {
    it("collects anchor lines from edits", () => {
      const section = new PatchSection({
        path: "f",
        fileHash: "A1B2",
        diffLines: ["replace 5..7:", "+a", "+b", "+c"],
      });
      const lines = section.collectAnchorLines();
      expect(lines).toEqual([5, 6, 7]);
    });

    it("deduplicates", () => {
      const section = new PatchSection({
        path: "f",
        fileHash: "A1B2",
        diffLines: ["delete 3", "insert before 3:", "+x"],
      });
      const lines = section.collectAnchorLines();
      expect(lines).toEqual([3]);
    });
  });
});

describe("Patch", () => {
  describe("parse", () => {
    it("parses single-section input", () => {
      const patch = Patch.parse("¶foo.ts#A1B2\nreplace 1..1:\n+new line\n");
      expect(patch.sections).toHaveLength(1);
      const s = patch.sections[0]!;
      expect(s.path).toBe("foo.ts");
      expect(s.fileHash).toBe("A1B2");
      expect(s.edits).toHaveLength(2);
    });

    it("parses multi-section input", () => {
      const patch = Patch.parse(
        "¶a.ts#AAAA\nreplace 1..1:\n+hello\n¶b.ts#BBBB\ndelete 3\n",
      );
      expect(patch.sections).toHaveLength(2);
      expect(patch.sections[0]!.path).toBe("a.ts");
      expect(patch.sections[0]!.fileHash).toBe("AAAA");
      expect(patch.sections[1]!.path).toBe("b.ts");
      expect(patch.sections[1]!.fileHash).toBe("BBBB");
    });

    it("rejects input without ¶PATH#TAG header", () => {
      expect(() => Patch.parse("replace 1..1:\n+line\n")).toThrow(
        /must begin with/,
      );
    });

    it("rejects empty input", () => {
      expect(() => Patch.parse("")).toThrow(/must begin with/);
    });

    it("rejects whitespace-only input", () => {
      expect(() => Patch.parse("   \n  \n")).toThrow(/must begin with/);
    });

    it("silently drops lines before the first header", () => {
      // Lines before first ¶ header are dropped; only one section
      const patch = Patch.parse(
        "some preamble\n¶foo.ts#A1B2\nreplace 1..1:\n+line\n",
      );
      expect(patch.sections).toHaveLength(1);
      expect(patch.sections[0]!.path).toBe("foo.ts");
    });

    it("sections without ops are excluded", () => {
      // First section has no ops (only blank), second has ops
      const patch = Patch.parse(
        "¶empty.ts#A1B2\n\n¶real.ts#BBBB\nreplace 1..1:\n+line\n",
      );
      expect(patch.sections).toHaveLength(1);
      expect(patch.sections[0]!.path).toBe("real.ts");
    });

    it("handles header without hash", () => {
      const patch = Patch.parse("¶foo.ts\nreplace 1..1:\n+line\n");
      expect(patch.sections).toHaveLength(1);
      expect(patch.sections[0]!.fileHash).toBeUndefined();
    });

    it("normalizes absolute paths to cwd-relative", () => {
      const patch = Patch.parse(
        "¶/home/user/project/src/foo.ts#A1B2\nreplace 1..1:\n+line\n",
        { cwd: "/home/user/project" },
      );
      expect(patch.sections[0]!.path).toBe("src/foo.ts");
    });
  });

  describe("parseSingle", () => {
    it("returns the first section", () => {
      const section = Patch.parseSingle("¶foo.ts#A1B2\nreplace 1..1:\n+line\n");
      expect(section.path).toBe("foo.ts");
    });

    it("throws on empty input", () => {
      expect(() => Patch.parseSingle("")).toThrow();
    });
  });
});
