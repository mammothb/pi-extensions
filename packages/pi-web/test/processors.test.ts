import { describe, expect, it } from "vitest";
import { toMarkdown, toText } from "../src/lib/processors.js";

describe("toMarkdown", () => {
  describe("basic HTML conversion", () => {
    it("converts headings", () => {
      const html = "<h1>Title</h1><h2>Subtitle</h2>";
      const result = toMarkdown("text/html", html);
      expect(result).toContain("# Title");
      expect(result).toContain("## Subtitle");
    });

    it("converts paragraphs", () => {
      const html = "<p>Hello world</p><p>Second paragraph</p>";
      const result = toMarkdown("text/html", html);
      expect(result).toContain("Hello world");
      expect(result).toContain("Second paragraph");
    });

    it("converts links", () => {
      const html = '<a href="https://example.com">Example</a>';
      const result = toMarkdown("text/html", html);
      expect(result).toContain("[Example](https://example.com)");
    });

    it("converts inline formatting", () => {
      const html = "<b>bold</b><i>italic</i><code>code</code>";
      const result = toMarkdown("text/html", html);
      expect(result).toContain("**bold**");
      expect(result).toContain("*italic*");
      expect(result).toContain("`code`");
    });
  });

  describe("non-HTML content types", () => {
    it("returns body unchanged for text/plain", () => {
      const plain = "Just some plain text, not HTML.";
      const result = toMarkdown("text/plain", plain);
      expect(result).toBe(plain);
    });

    it("returns body unchanged for application/json", () => {
      const json = '{"key": "value"}';
      const result = toMarkdown("application/json", json);
      expect(result).toBe(json);
    });

    it("returns body unchanged even when content looks like HTML", () => {
      const html = "<h1>Looks like HTML</h1>";
      const result = toMarkdown("application/xml", html);
      expect(result).toBe(html);
    });
  });

  describe("tag stripping", () => {
    it("strips <script> tags and their content", () => {
      const html = "<h1>Title</h1><script>alert('xss')</script><p>Safe</p>";
      const result = toMarkdown("text/html", html);
      expect(result).not.toContain("alert");
      expect(result).not.toContain("script");
      expect(result).toContain("Title");
      expect(result).toContain("Safe");
    });

    it("strips <style> tags and their content", () => {
      const html =
        "<h1>Title</h1><style>body { color: red; }</style><p>Safe</p>";
      const result = toMarkdown("text/html", html);
      expect(result).not.toContain("color");
      expect(result).not.toContain("style");
      expect(result).toContain("Title");
      expect(result).toContain("Safe");
    });

    it("strips <link> tags", () => {
      const html = '<link rel="stylesheet" href="style.css"><h1>Title</h1>';
      const result = toMarkdown("text/html", html);
      expect(result).toContain("Title");
      expect(result).not.toContain("stylesheet");
    });

    it("strips <meta> tags", () => {
      const html =
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><h1>Title</h1>';
      const result = toMarkdown("text/html", html);
      expect(result).toContain("Title");
      expect(result).not.toContain("charset");
    });
  });
});

describe("toText", () => {
  describe("text extraction", () => {
    it("extracts text from HTML, stripping tags", () => {
      const html = "<h1>Title</h1><p>Hello <b>world</b></p>";
      const result = toText("text/html", html);
      expect(result).toBe("TitleHello world");
    });

    it("collapses whitespace naturally", () => {
      const html = "<div>Line 1</div>\n<div>Line 2</div>";
      const result = toText("text/html", html);
      // The parser concatenates text nodes; newlines come from the HTML source
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
    });
  });

  describe("skip tags", () => {
    const skipTags = ["script", "style", "noscript", "iframe", "object"];

    for (const tag of skipTags) {
      it(`skips <${tag}> content`, () => {
        const html = `<h1>Before</h1><${tag}>hidden content</${tag}><p>After</p>`;
        const result = toText("text/html", html);
        expect(result).toContain("Before");
        expect(result).toContain("After");
        expect(result).not.toContain("hidden content");
      });
    }

    it("does NOT skip <embed> content (void element, auto-closed by parser)", () => {
      // htmlparser2 treats <embed> as a void element and auto-closes it
      // immediately. The text between <embed> and </embed> in the source
      // falls *after* the auto-close, so it cannot be skipped by the
      // open/close depth tracking approach.
      const html = "<p>Before</p><embed>hidden content</embed><p>After</p>";
      const result = toText("text/html", html);
      expect(result).toContain("Before");
      expect(result).toContain("After");
      // embed is void — content is not skipped
      expect(result).toContain("hidden content");
    });
  });

  describe("nested skip tags", () => {
    it("handles nested skip tags of different types", () => {
      // A skip tag (script) nested inside another (style) — both must be
      // skipped, and closing the inner one must not bring skip depth below
      // the outer's level.
      const html =
        "<p>Hi</p><style>css{} <script>alert(1)</script> more css</style><p>Bye</p>";
      const result = toText("text/html", html);
      expect(result).toContain("Hi");
      expect(result).toContain("Bye");
      expect(result).not.toContain("css");
      expect(result).not.toContain("alert");
    });

    it("does not double-decrement when skip tags self-nest in source", () => {
      // In valid HTML, <script> cannot contain another <script> — the
      // parser treats everything until the first </script> as raw text.
      // The text after the first </script> is outside the skip window.
      // This test verifies the skip depth never goes negative.
      const html =
        "<p>Visible 1</p><script>raw text <script>inner</script> outside</script><p>Visible 2</p>";
      const result = toText("text/html", html);
      expect(result).toContain("Visible 1");
      expect(result).toContain("Visible 2");
      // "raw text <script>inner" is raw script content → skipped
      // " outside" comes after first </script> → not skipped (this is expected)
      expect(result).toContain("outside");
      expect(result).not.toContain("inner");
    });
  });

  describe("non-HTML content types", () => {
    it("returns body unchanged for text/plain", () => {
      const plain = "Just some plain text.";
      const result = toText("text/plain", plain);
      expect(result).toBe(plain);
    });

    it("returns body unchanged for application/json", () => {
      const json = '{"key": "value"}';
      const result = toText("application/json", json);
      expect(result).toBe(json);
    });
  });

  describe("empty HTML", () => {
    it("handles empty string", () => {
      const result = toText("text/html", "");
      expect(result).toBe("");
    });

    it("handles HTML with only skip tags", () => {
      const html = "<script>hidden</script><style>also hidden</style>";
      const result = toText("text/html", html);
      expect(result).toBe("");
    });

    it("handles whitespace-only HTML", () => {
      const html = "   \n  \n  ";
      const result = toText("text/html", html);
      expect(result).toBe("");
    });
  });
});
