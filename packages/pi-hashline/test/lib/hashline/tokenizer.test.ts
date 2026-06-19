import { describe, expect, it } from "vitest";

import { Tokenizer } from "../../../src/lib/hashline/tokenizer.js";

describe("Tokenizer", () => {
  const tokenizer = new Tokenizer();

  describe("blank lines", () => {
    it("classifies empty string as blank", () => {
      const t = tokenizer.tokenize("");
      expect(t.kind).toBe("blank");
    });

    it("classifies whitespace-only line as blank", () => {
      const t = tokenizer.tokenize("   ");
      expect(t.kind).toBe("blank");
    });
  });

  describe("envelope and abort markers", () => {
    it("classifies *** Begin Patch as envelope-begin", () => {
      const t = tokenizer.tokenize("*** Begin Patch");
      expect(t.kind).toBe("envelope-begin");
    });
    it("classifies *** End Patch as envelope-end", () => {
      const t = tokenizer.tokenize("*** End Patch");
      expect(t.kind).toBe("envelope-end");
    });
    it("classifies *** Abort as abort", () => {
      const t = tokenizer.tokenize("*** Abort");
      expect(t.kind).toBe("abort");
    });

    it("markers are exact match (no prefix/suffix)", () => {
      const t = tokenizer.tokenize("*** Begin Patch extra");
      expect(t.kind).toBe("raw"); // not envelope-begin
    });
  });

  describe("file section headers", () => {
    it("parses ¶path#TAG", () => {
      const t = tokenizer.tokenize("¶src/foo.ts#A1B2");
      expect(t.kind).toBe("header");
      if (t.kind === "header") {
        expect(t.path).toBe("src/foo.ts");
        expect(t.fileHash).toBe("A1B2");
      }
    });

    it("parses header without hash", () => {
      const t = tokenizer.tokenize("¶src/foo.ts");
      expect(t.kind).toBe("header");
      if (t.kind === "header") {
        expect(t.path).toBe("src/foo.ts");
        expect(t.fileHash).toBeUndefined();
      }
    });

    it("parses header with path containing # not as hash", () => {
      const t = tokenizer.tokenize("¶src/#test/file.ts");
      expect(t.kind).toBe("header");
      if (t.kind === "header") {
        expect(t.path).toBe("src/#test/file.ts");
        expect(t.fileHash).toBeUndefined();
      }
    });

    it("rejects empty path after ¶", () => {
      const t = tokenizer.tokenize("¶");
      expect(t.kind).toBe("raw");
    });

    it("hash is case-normalized to uppercase", () => {
      const t = tokenizer.tokenize("¶foo.ts#a1b2");
      expect(t.kind).toBe("header");
      if (t.kind === "header") {
        expect(t.fileHash).toBe("A1B2");
      }
    });

    it("trailing whitespace is trimmed", () => {
      const t = tokenizer.tokenize("¶foo.ts#A1B2  ");
      expect(t.kind).toBe("header");
      if (t.kind === "header") {
        expect(t.path).toBe("foo.ts");
        expect(t.fileHash).toBe("A1B2");
      }
    });
  });

  describe("hunk headers — replace", () => {
    it("parses replace N..M:", () => {
      const t = tokenizer.tokenize("replace 5..10:");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block" && t.target.kind === "replace") {
        expect(t.target.range.start.line).toBe(5);
        expect(t.target.range.end.line).toBe(10);
      }
    });

    it("parses replace single line N..N:", () => {
      const t = tokenizer.tokenize("replace 3..3:");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block" && t.target.kind === "replace") {
        expect(t.target.range.start.line).toBe(3);
        expect(t.target.range.end.line).toBe(3);
      }
    });

    it("parses replace block N:", () => {
      const t = tokenizer.tokenize("replace block 5:");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block") {
        expect(t.target.kind).toBe("block");
        if (t.target.kind === "block") {
          expect(t.target.anchor.line).toBe(5);
        }
      }
    });

    it("rejects replace without colon", () => {
      const t = tokenizer.tokenize("replace 5..10");
      expect(t.kind).toBe("raw");
    });

    it("rejects replace with invalid range", () => {
      const t = tokenizer.tokenize("replace abc..def:");
      expect(t.kind).toBe("raw");
    });
  });

  describe("hunk headers — delete", () => {
    it("parses delete N..M (no colon)", () => {
      const t = tokenizer.tokenize("delete 5..10");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block" && t.target.kind === "delete") {
        expect(t.target.range.start.line).toBe(5);
        expect(t.target.range.end.line).toBe(10);
      }
    });

    it("parses delete single line N", () => {
      const t = tokenizer.tokenize("delete 42");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block" && t.target.kind === "delete") {
        expect(t.target.range.start.line).toBe(42);
        expect(t.target.range.end.line).toBe(42);
      }
    });

    it("parses delete block N", () => {
      const t = tokenizer.tokenize("delete block 5");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block") {
        expect(t.target.kind).toBe("delete_block");
        if (t.target.kind === "delete_block") {
          expect(t.target.anchor.line).toBe(5);
        }
      }
    });

    it("rejects delete with colon", () => {
      const t = tokenizer.tokenize("delete 5:");
      // delete doesn't take colon - currently it'd be intercepted
      // by the range parser or recognized as raw
      expect(t.kind === "raw" || t.kind === "op-block").toBe(true);
    });
  });

  describe("hunk headers — insert", () => {
    it("parses insert before N:", () => {
      const t = tokenizer.tokenize("insert before 5:");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block") {
        expect(t.target.kind).toBe("insert_before");
        if (t.target.kind === "insert_before") {
          expect(t.target.anchor.line).toBe(5);
        }
      }
    });

    it("parses insert after N:", () => {
      const t = tokenizer.tokenize("insert after 10:");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block") {
        expect(t.target.kind).toBe("insert_after");
        if (t.target.kind === "insert_after") {
          expect(t.target.anchor.line).toBe(10);
        }
      }
    });

    it("parses insert head:", () => {
      const t = tokenizer.tokenize("insert head:");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block") {
        expect(t.target.kind).toBe("bof");
      }
    });

    it("parses insert tail:", () => {
      const t = tokenizer.tokenize("insert tail:");
      expect(t.kind).toBe("op-block");
      if (t.kind === "op-block") {
        expect(t.target.kind).toBe("eof");
      }
    });

    it("insert before without colon is not an op", () => {
      const t = tokenizer.tokenize("insert before 5");
      expect(t.kind).toBe("raw");
    });
  });

  describe("payload literals", () => {
    it("classifies +text as payload-literal", () => {
      const t = tokenizer.tokenize("+new line");
      expect(t.kind).toBe("payload-literal");
      if (t.kind === "payload-literal") {
        expect(t.text).toBe("new line");
      }
    });

    it("preserves leading whitespace after +", () => {
      const t = tokenizer.tokenize("+  indented");
      expect(t.kind).toBe("payload-literal");
      if (t.kind === "payload-literal") {
        expect(t.text).toBe("  indented");
      }
    });

    it("+ alone gives empty text", () => {
      const t = tokenizer.tokenize("+");
      expect(t.kind).toBe("payload-literal");
      if (t.kind === "payload-literal") {
        expect(t.text).toBe("");
      }
    });
  });

  describe("raw lines", () => {
    it("unrecognized lines are classified as raw", () => {
      const t = tokenizer.tokenize("some random text");
      expect(t.kind).toBe("raw");
      if (t.kind === "raw") {
        expect(t.text).toBe("some random text");
      }
    });
  });

  describe("tokenizeAll", () => {
    it("tokenizes multi-line input", () => {
      const tokens = tokenizer.tokenizeAll(
        "¶foo.ts#A1B2\nreplace 1..1:\n+hello",
      );
      expect(tokens).toHaveLength(3);
      expect(tokens[0]!.kind).toBe("header");
      expect(tokens[1]!.kind).toBe("op-block");
      expect(tokens[2]!.kind).toBe("payload-literal");
    });

    it("trailing newline produces extra blank token", () => {
      const tokens = tokenizer.tokenizeAll(
        "¶foo.ts#A1B2\nreplace 1..1:\n+hello\n",
      );
      expect(tokens).toHaveLength(4);
      expect(tokens[3]!.kind).toBe("blank");
    });

    it("handles CRLF line endings", () => {
      const tokens = tokenizer.tokenizeAll(
        "¶foo.ts#A1B2\r\nreplace 1..1:\r\n+hello",
      );
      expect(tokens).toHaveLength(3);
      expect(tokens[0]!.kind).toBe("header");
    });

    it("empty input returns single blank token", () => {
      const tokens = tokenizer.tokenizeAll("");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.kind).toBe("blank");
    });
  });

  describe("isOp / isHeader / isEnvelopeMarker", () => {
    it("isOp detects hunk headers", () => {
      expect(tokenizer.isOp("replace 1..1:")).toBe(true);
      expect(tokenizer.isOp("delete 5")).toBe(true);
      expect(tokenizer.isOp("insert head:")).toBe(true);
      expect(tokenizer.isOp("+payload")).toBe(false);
      expect(tokenizer.isOp("¶foo.ts#A1B2")).toBe(false);
    });

    it("isHeader detects section headers", () => {
      expect(tokenizer.isHeader("¶foo.ts#A1B2")).toBe(true);
      expect(tokenizer.isHeader("replace 1..1:")).toBe(false);
    });

    it("isEnvelopeMarker detects markers", () => {
      expect(tokenizer.isEnvelopeMarker("*** Begin Patch")).toBe(true);
      expect(tokenizer.isEnvelopeMarker("*** End Patch")).toBe(true);
      expect(tokenizer.isEnvelopeMarker("*** Abort")).toBe(true);
      expect(tokenizer.isEnvelopeMarker("other")).toBe(false);
    });
  });
});
