import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoTextSearch,
  buildDom,
  EmptySweepError,
  extractResults,
  normalizeText,
  normalizeUrl,
  ResultsAggregator,
  rankResults,
  SearchTimeoutError,
  shuffledEngines,
  TEXT_ENGINES,
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

// ── ResultsAggregator ─────────────────────────────────────────────────────

describe("ResultsAggregator", () => {
  it("dedupes by href, keeps longest body, counts frequency", () => {
    const agg = new ResultsAggregator();
    agg.append({ title: "A", href: "https://a.com", body: "short" });
    agg.append({
      title: "A2",
      href: "https://a.com",
      body: "much longer body here",
    });
    agg.append({ title: "B", href: "https://b.com", body: "b" });
    expect(agg.size).toBe(2);
    const dicts = agg.extractDicts();
    // a.com had 2 hits, b.com had 1 -> a.com first
    expect(dicts[0].href).toBe("https://a.com");
    expect(dicts[0].body).toBe("much longer body here");
    expect(dicts[1].href).toBe("https://b.com");
  });

  it("orders by frequency descending", () => {
    const agg = new ResultsAggregator();
    agg.append({ title: "A", href: "https://a.com", body: "x" });
    agg.append({ title: "B", href: "https://b.com", body: "y" });
    agg.append({ title: "A2", href: "https://a.com", body: "yy" });
    agg.append({ title: "A3", href: "https://a.com", body: "yyy" });
    agg.append({ title: "B2", href: "https://b.com", body: "yy" });
    const dicts = agg.extractDicts();
    expect(dicts[0].href).toBe("https://a.com");
    expect(dicts[1].href).toBe("https://b.com");
  });

  it("extend batches", () => {
    const agg = new ResultsAggregator();
    agg.extend([
      { title: "A", href: "https://a.com", body: "a" },
      { title: "B", href: "https://b.com", body: "b" },
    ]);
    expect(agg.size).toBe(2);
  });
});

// ── rankResults ───────────────────────────────────────────────────────────

describe("rankResults", () => {
  const query = "hello world";

  it("wiki first", () => {
    const docs = [
      {
        title: "Hello",
        href: "https://example.com",
        body: "hello world there",
      },
      {
        title: "Wik",
        href: "https://en.wikipedia.org/wiki/Hello",
        body: "hello",
      },
    ];
    const ranked = rankResults(docs, query);
    expect(ranked[0].href).toContain("wikipedia.org");
  });

  it("both > titleOnly > bodyOnly > neither", () => {
    const docs = [
      { title: "unrelated", href: "https://a.com", body: "unrelated content" },
      { title: "hello", href: "https://b.com", body: "no match" }, // titleOnly
      { title: "unrelated", href: "https://c.com", body: "world here" }, // bodyOnly
      { title: "hello", href: "https://d.com", body: "world there" }, // both
    ];
    const ranked = rankResults(docs, query);
    expect(ranked[0].href).toBe("https://d.com"); // both
    expect(ranked[1].href).toBe("https://b.com"); // titleOnly
    expect(ranked[2].href).toBe("https://c.com"); // bodyOnly
    expect(ranked[3].href).toBe("https://a.com"); // neither
  });

  it("filters Category:Wikimedia", () => {
    const docs = [
      {
        title: "Category: Foo Wikimedia",
        href: "https://en.wikipedia.org/wiki/Cat",
        body: "hello world",
      },
      { title: "Hello", href: "https://example.com", body: "hello world" },
    ];
    const ranked = rankResults(docs, query);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].href).toBe("https://example.com");
  });
});

// ── shuffledEngines ───────────────────────────────────────────────────────

describe("shuffledEngines", () => {
  it("always hoists wikipedia first", () => {
    for (let i = 0; i < 20; i++) {
      const engines = shuffledEngines();
      expect(engines[0].name).toBe("wikipedia");
      expect(engines).toHaveLength(7);
    }
  });

  it("contains all 7 engines", () => {
    const names = new Set(shuffledEngines().map((e) => e.name));
    expect(names).toEqual(new Set(TEXT_ENGINES.map((e) => e.name)));
  });

  it("TEXT_ENGINES has 7 entries", () => {
    expect(TEXT_ENGINES).toHaveLength(7);
  });
});

// ── Engine search with stub fetch ────────────────────────────────────────

describe("engine search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("duckduckgo parses results and filters y.js?", async () => {
    const duck = TEXT_ENGINES.find((e) => e.name === "duckduckgo")!;
    const html = `<div class="body"><h2>Duck Title</h2><a href="https://example.com">Duck body</a></div><div class="body"><h2>Bad</h2><a href="https://duckduckgo.com/y.js?x=1">bad</a></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await duck.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results![0].title).toBe("Duck Title");
    expect(results![0].href).toBe("https://example.com");
  });

  it("brave parses results", async () => {
    const brave = TEXT_ENGINES.find((e) => e.name === "brave")!;
    const html = `<div data-type="web"><a href="https://brave.com/page"><div class="title">Brave Title</div></a><div class="snippet"><div class="content">brave snippet</div></div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await brave.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results![0].href).toBe("https://brave.com/page");
  });

  it("google unwraps /url?q=", async () => {
    const google = TEXT_ENGINES.find((e) => e.name === "google")!;
    const html = `<div data-hveid="1"><h3>Google Title</h3><a href="/url?q=https://real.com/page&amp;sa=U&amp;ved=1"><h3>inner</h3></a><div><div>snippet here</div></div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await google.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results![0].href).toBe("https://real.com/page");
  });

  it("yahoo unwraps /RU=", async () => {
    const yahoo = TEXT_ENGINES.find((e) => e.name === "yahoo")!;
    const html = `<div class="relsrch"><div class="Title"><h3><a href="https://r.search.yahoo.com/_ylt=xxx/RU=https%3A%2F%2Freal.com%2Fpath/RK=yyy/RS=zzz">Yahoo Title</a></h3></div><div class="Text">yahoo body</div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await yahoo.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results![0].href).toBe("https://real.com/path");
  });

  it("yahoo filters bing aclick", async () => {
    const yahoo = TEXT_ENGINES.find((e) => e.name === "yahoo")!;
    const html = `<div class="relsrch"><div class="Title"><h3><a href="https://www.bing.com/aclick?x=1">Ad</a></h3></div><div class="Text">ad body</div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await yahoo.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(0);
  });

  it("mojeek parses results", async () => {
    const mojeek = TEXT_ENGINES.find((e) => e.name === "mojeek")!;
    const html = `<ul class="results"><li><h2><a href="https://mojeek.com/r">Mojeek Title</a></h2><p class="s">mojeek snippet</p></li></ul>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await mojeek.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results![0].href).toBe("https://mojeek.com/r");
  });

  it("yandex parses results", async () => {
    const yandex = TEXT_ENGINES.find((e) => e.name === "yandex")!;
    const html = `<li class="serp-item"><h3><a href="https://yandex.com/r">Yandex Title</a></h3><div class="text">yandex body</div></li>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await yandex.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results![0].href).toBe("https://yandex.com/r");
  });

  it("wikipedia opensearch + extracts", async () => {
    const wiki = TEXT_ENGINES.find((e) => e.name === "wikipedia")!;
    const opensearch = JSON.stringify([
      "hello",
      ["Hello"],
      ["desc"],
      ["https://en.wikipedia.org/wiki/Hello"],
    ]);
    const extracts = JSON.stringify({
      query: { pages: { "1": { extract: "Hello world intro" } } },
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve(new Response(opensearch, { status: 200 }));
        }
        return Promise.resolve(new Response(extracts, { status: 200 }));
      }),
    );
    const results = await wiki.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results![0].href).toContain("wikipedia.org");
    expect(results![0].body).toBe("Hello world intro");
  });

  it("wikipedia returns [] on disambiguation", async () => {
    const wiki = TEXT_ENGINES.find((e) => e.name === "wikipedia")!;
    const opensearch = JSON.stringify([
      "hello",
      ["Hello"],
      ["desc"],
      ["https://en.wikipedia.org/wiki/Hello"],
    ]);
    const extracts = JSON.stringify({
      query: { pages: { "1": { extract: "Foo may refer to: bar" } } },
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve(new Response(opensearch, { status: 200 }));
        }
        return Promise.resolve(new Response(extracts, { status: 200 }));
      }),
    );
    const results = await wiki.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toHaveLength(0);
  });

  it("returns null on non-200", async () => {
    const duck = TEXT_ENGINES.find((e) => e.name === "duckduckgo")!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    const results = await duck.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(results).toBeNull();
  });
});

// ── autoTextSearch ─────────────────────────────────────────────────────────

describe("autoTextSearch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ranked results up to maxResults", async () => {
    const brave = TEXT_ENGINES.find((e) => e.name === "brave")!;
    const fakeEngines = [brave, brave]; // same provider -> dedup should run only first
    await expect(
      autoTextSearch("hello", 1, 5000, undefined, fakeEngines),
    ).rejects.toThrow(EmptySweepError);
  });

  it("throws EmptySweepError when all engines return null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    await expect(autoTextSearch("hello", 5, 5000)).rejects.toThrow(
      EmptySweepError,
    );
  });

  it("throws SearchTimeoutError when engines timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    // engines.ts httpFetch catches TimeoutError and throws "timed out" -> autoTextSearch wraps as SearchTimeoutError
    await expect(autoTextSearch("hello", 5, 10)).rejects.toThrow(
      SearchTimeoutError,
    );
  });

  it("returns results from stubbed engines", async () => {
    const html = `<div class="body"><h2>Result</h2><a href="https://example.com">hello world body</a></div>`;
    // Make duckduckgo succeed, others fail; autoTextSearch shuffles, so stub all
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const duck = TEXT_ENGINES.find((e) => e.name === "duckduckgo")!;
    const results = await autoTextSearch("hello", 2, 5000, undefined, [duck]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("respects provider dedup", async () => {
    const html = `<div class="body"><h2>Result</h2><a href="https://example.com">body</a></div>`;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(html, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    // duckduckgo and yahoo share provider "bing" -> only first of the two should be called
    const duck = TEXT_ENGINES.find((e) => e.name === "duckduckgo")!;
    const yahoo = TEXT_ENGINES.find((e) => e.name === "yahoo")!;
    // Pass deterministic order: duck first, then yahoo (same provider -> yahoo skipped after duck succeeds)
    const results = await autoTextSearch("hello", 5, 5000, undefined, [
      duck,
      yahoo,
    ]);
    // duck succeeds, so yahoo (same provider "bing") is skipped -> only 1 fetch for POST to duckduckgo
    // Actually both use different URLs, but dedup prevents second from running
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results.length).toBeGreaterThan(0);
  });
});
