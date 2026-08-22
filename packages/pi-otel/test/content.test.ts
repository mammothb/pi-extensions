import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyCaptureMode,
  sha256,
  summarize,
  toContent,
} from "../src/content.js";

describe("content", () => {
  describe("sha256", () => {
    it("matches node:crypto output", () => {
      expect(sha256("hello")).toBe(
        createHash("sha256").update("hello").digest("hex"),
      );
    });

    it("is stable across calls", () => {
      expect(sha256("same")).toBe(sha256("same"));
    });

    it("accepts Uint8Array", () => {
      const bytes = new Uint8Array([1, 2, 3]);
      expect(sha256(bytes)).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    });

    it("differs for different inputs", () => {
      expect(sha256("a")).not.toBe(sha256("b"));
    });
  });

  describe("summarize", () => {
    it("returns the full text when short", () => {
      const s = summarize("short", 100);
      expect(s.summary).toBe("short");
      expect(s.truncated).toBe(false);
      expect(s.sha256).toBe(sha256("short"));
    });

    it("truncates at maxLen with an ellipsis", () => {
      const s = summarize("abcdef", 3);
      expect(s.summary).toBe("abc…");
      expect(s.truncated).toBe(true);
    });

    it("hashes the untruncated input", () => {
      const input = "x".repeat(1000);
      const s = summarize(input, 10);
      expect(s.sha256).toBe(sha256(input));
    });
  });

  describe("applyCaptureMode", () => {
    it("off returns only the hash", () => {
      const r = applyCaptureMode("secret", "off", 512);
      expect(r.sha256).toBe(sha256("secret"));
      expect(r.content).toBeUndefined();
    });

    it("summary returns hash + truncated content", () => {
      const r = applyCaptureMode("abcdef", "summary", 3);
      expect(r.sha256).toBe(sha256("abcdef"));
      expect(r.content).toBe("abc…");
      expect(r.truncated).toBe(true);
    });

    it("full returns hash + raw content", () => {
      const r = applyCaptureMode("abcdef", "full", 3);
      expect(r.sha256).toBe(sha256("abcdef"));
      expect(r.content).toBe("abcdef");
      expect(r.truncated).toBe(false);
    });
  });

  describe("toContent", () => {
    it("passes strings through", () => {
      expect(toContent("hello")).toBe("hello");
    });

    it("serializes objects to JSON", () => {
      expect(toContent({ a: 1 })).toBe('{"a":1}');
    });

    it("returns empty string for undefined/null", () => {
      expect(toContent(undefined)).toBe("");
      expect(toContent(null)).toBe("");
    });

    it("falls back to a type-tagged marker for circular refs", () => {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      expect(toContent(obj)).toBe("[unserializable object]");
    });

    it("returns a string marker for functions and symbols", () => {
      expect(toContent(() => {})).toBe("[unserializable function]");
      expect(toContent(Symbol("x"))).toBe("[unserializable symbol]");
    });

    it("stringifies numbers and booleans", () => {
      expect(toContent(42)).toBe("42");
      expect(toContent(true)).toBe("true");
    });
  });
});
