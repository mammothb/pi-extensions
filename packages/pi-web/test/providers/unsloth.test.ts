import { describe, expect, it } from "vitest";
import {
  buildDom,
  extractResults,
  normalizeText,
  normalizeUrl,
  xpathNodes,
  xpathText,
} from "../../src/lib/providers/unsloth";

// ── normalizeText ─────────────────────────────────────────────────────────

describe("normalizeText", () => {
  it("strips html tags", () => {
    expect(normalizeText("<b>hello</b> world")).toBe("hello world");
  });

  it("decodes common entities", () => {
    expect(normalizeText("a &amp; b")).toBe("a & b");
    expect(normalizeText("a &lt;b&gt;")).toBe("a <b>");
  });

  it("trims and collapses whitespace", () => {
    expect(normalizeText("  hello   world  ")).toBe("hello world");
    expect(normalizeText("\n hello \t world \n")).toBe("hello world");
  });

  it("strips control characters", () => {
    expect(normalizeText("hello\x00world")).toBe("helloworld");
  });

  it("handles empty input", () => {
    expect(normalizeText("")).toBe("");
  });

  it("normalizes NFC", () => {
    // e + combining accent vs precomposed — NFC should unify
    const decomposed = "e\u0301"; // e + combining acute
    expect(normalizeText(decomposed)).toBe("\u00E9");
  });
});

// ── normalizeUrl ──────────────────────────────────────────────────────────

describe("normalizeUrl", () => {
  it("decodes encoded url", () => {
    expect(normalizeUrl("https://example.com/a%20b")).toBe(
      "https://example.com/a+b",
    );
  });

  it("replaces spaces with +", () => {
    expect(normalizeUrl("https://example.com/a b")).toBe(
      "https://example.com/a+b",
    );
  });

  it("handles empty", () => {
    expect(normalizeUrl("")).toBe("");
  });

  it("handles invalid encoding gracefully", () => {
    expect(normalizeUrl("https://example.com/%ZZ")).toBe(
      "https://example.com/%ZZ",
    );
  });
});

// ── buildDom + xpathNodes/xpathText via extractResults ───────────────────

describe("buildDom and XPath", () => {
  it("parses simple html and extracts via xpath", () => {
    const html = `
      <div class="body"><h2>Hello</h2><a href="https://example.com">snippet here</a></div>
      <div class="body"><h2>World</h2><a href="https://other.com">other snippet</a></div>
    `;
    const results = extractResults(html, "//div[contains(@class, 'body')]", {
      title: ".//h2//text()",
      href: "./a/@href",
      body: "./a//text()",
    });
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Hello");
    expect(results[0].href).toBe("https://example.com");
    expect(results[0].body).toBe("snippet here");
    expect(results[1].title).toBe("World");
    expect(results[1].href).toBe("https://other.com");
  });

  it("handles braveresult-style data-type attr", () => {
    const html = `
      <div data-type="web"><a href="https://brave.com"><div class="title">Brave Result</div></a><div class="snippet"><div class="content">brave body</div></div></div>
    `;
    const results = extractResults(html, "//div[@data-type='web']", {
      title: ".//div[contains(@class, 'title')]//text()",
      href: "./a/@href",
      body: ".//div[contains(@class, 'snippet')]//text()",
    });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Brave Result");
    expect(results[0].href).toBe("https://brave.com");
  });

  it("handles attribute equality predicate", () => {
    const html = `<div data-type="web"><span>hi</span></div><div data-type="other"><span>bye</span></div>`;
    const root = buildDom(html);
    const nodes = xpathNodes("//div[@data-type='web']", root);
    expect(nodes).toHaveLength(1);
    expect(xpathText(".//span//text()", nodes[0]).join("")).toBe("hi");
  });

  it("handles contains(@class) predicate", () => {
    const html = `<ul><li class="serp-item"><h3>Title</h3></li><li class="other"><h3>Skip</h3></li></ul>`;
    const results = extractResults(
      html,
      "//li[contains(@class, 'serp-item')]",
      {
        title: ".//h3//text()",
        href: ".//a/@href",
        body: ".//div//text()",
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Title");
  });

  it("handles position()=last() predicate", () => {
    const html = `
      <div class="outer">
        <div class="item">first</div>
        <div class="item">last</div>
      </div>
    `;
    const root = buildDom(html);
    const nodes = xpathNodes("//div[contains(@class, 'outer')]", root);
    expect(nodes).toHaveLength(1);
    const items = xpathText("./div[position()=last()]//text()", nodes[0]);
    expect(items.join("").trim()).toBe("last");
  });

  it("handles // descendant axis and .// relative descendant", () => {
    const html = `<div><section><p>deep</p></section></div>`;
    const root = buildDom(html);
    const ps = xpathNodes("//p", root);
    expect(ps).toHaveLength(1);
    expect(xpathText(".//text()", ps[0]).join("").trim()).toBe("deep");
  });

  it("handles @href terminal", () => {
    const html = `<a href="https://example.com/path?q=1">text</a>`;
    const root = buildDom(html);
    const links = xpathNodes("//a", root);
    expect(xpathText("./@href", links[0])[0]).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("returns empty when no match", () => {
    const html = `<div><p>hi</p></div>`;
    const results = extractResults(html, "//section", {
      title: ".//h2//text()",
      href: "./a/@href",
      body: "./p//text()",
    });
    expect(results).toHaveLength(0);
  });

  it("handles malformed html gracefully", () => {
    const html = `<div><p>unclosed<div>more`;
    const root = buildDom(html);
    // Should not throw, should produce some nodes
    const divs = xpathNodes("//div", root);
    expect(divs.length).toBeGreaterThan(0);
  });

  it("decodes entities via htmlparser2 + normalize in extractResults", () => {
    const html = `<div class="body"><h2>A &amp; B</h2><a href="https://example.com">a &amp; b</a></div>`;
    const results = extractResults(html, "//div[contains(@class, 'body')]", {
      title: ".//h2//text()",
      href: "./a/@href",
      body: "./a//text()",
    });
    expect(results[0].title).toBe("A & B");
    expect(results[0].body).toBe("a & b");
  });
});
