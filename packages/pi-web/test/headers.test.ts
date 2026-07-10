import { describe, expect, it } from "vitest";
import { buildHeaders } from "../src/lib/headers.js";

describe("buildHeaders", () => {
  describe("format: markdown", () => {
    it("prefers markdown types in Accept header", () => {
      const result = buildHeaders("markdown");
      expect(result.Accept).toContain("text/markdown;q=1.0");
      expect(result.Accept).toContain("text/x-markdown;q=0.9");
      expect(result.Accept).toContain("text/html;q=0.7");
    });

    it("includes User-Agent", () => {
      const result = buildHeaders("markdown");
      expect(result["User-Agent"]).toBeTruthy();
      expect(result["User-Agent"]).toContain("Mozilla/5.0");
    });

    it("includes Accept-Language", () => {
      const result = buildHeaders("markdown");
      expect(result["Accept-Language"]).toBe("en-US,en;q=0.9");
    });
  });

  describe("format: text", () => {
    it("prefers plain text in Accept header", () => {
      const result = buildHeaders("text");
      expect(result.Accept).toContain("text/plain;q=1.0");
      expect(result.Accept).toContain("text/markdown;q=0.9");
      expect(result.Accept).toContain("text/html;q=0.8");
    });

    it("includes User-Agent and Accept-Language", () => {
      const result = buildHeaders("text");
      expect(result["User-Agent"]).toBeTruthy();
      expect(result["Accept-Language"]).toBe("en-US,en;q=0.9");
    });
  });

  describe("format: html", () => {
    it("prefers HTML in Accept header", () => {
      const result = buildHeaders("html");
      expect(result.Accept).toContain("text/html;q=1.0");
      expect(result.Accept).toContain("application/xhtml+xml;q=0.9");
    });

    it("includes User-Agent and Accept-Language", () => {
      const result = buildHeaders("html");
      expect(result["User-Agent"]).toBeTruthy();
      expect(result["Accept-Language"]).toBe("en-US,en;q=0.9");
    });
  });

  describe("default/unknown format", () => {
    it("returns browser-like Accept header", () => {
      // The function is typed to only accept Format values, but the switch
      // default covers unknown formats. We cast to test this path.
      const result = buildHeaders("unknown" as "markdown");
      expect(result.Accept).toContain("text/html");
      expect(result.Accept).toContain("application/xhtml+xml");
      expect(result.Accept).toContain("image/avif");
      expect(result.Accept).toContain("image/webp");
      expect(result.Accept).toContain("image/apng");
      expect(result.Accept).toContain("*/*;q=0.8");
    });

    it("still includes User-Agent and Accept-Language", () => {
      const result = buildHeaders("unknown" as "markdown");
      expect(result["User-Agent"]).toBeTruthy();
      expect(result["Accept-Language"]).toBe("en-US,en;q=0.9");
    });
  });

  describe("return shape", () => {
    it("returns exactly the expected keys", () => {
      for (const format of ["markdown", "text", "html"] as const) {
        const result = buildHeaders(format);
        const keys = Object.keys(result).sort();
        expect(keys).toEqual(["Accept", "Accept-Language", "User-Agent"]);
      }
    });

    it("returns consistent User-Agent across all formats", () => {
      const uaMarkdown = buildHeaders("markdown")["User-Agent"];
      const uaText = buildHeaders("text")["User-Agent"];
      const uaHtml = buildHeaders("html")["User-Agent"];
      expect(uaMarkdown).toBe(uaText);
      expect(uaMarkdown).toBe(uaHtml);
    });

    it("returns consistent Accept-Language across all formats", () => {
      const alMarkdown = buildHeaders("markdown")["Accept-Language"];
      const alText = buildHeaders("text")["Accept-Language"];
      const alHtml = buildHeaders("html")["Accept-Language"];
      expect(alMarkdown).toBe(alText);
      expect(alMarkdown).toBe(alHtml);
    });
  });
});
