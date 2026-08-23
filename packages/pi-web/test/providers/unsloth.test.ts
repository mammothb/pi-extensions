import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoTextSearch,
  buildDom,
  collectSearchError,
  createUnslothProvider,
  EmptySweepError,
  extractResults,
  formatSearchResults,
  normalizeText,
  normalizeUrl,
  ResultsAggregator,
  rankResults,
  SearchCancelled,
  SearchTimeoutError,
  shuffledEngines,
  shuffleEnginesWithPriority,
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

  it("provider dedup skips second engine with same provider", async () => {
    const duck = TEXT_ENGINES.find((e) => e.name === "duckduckgo")!;
    const yahoo = TEXT_ENGINES.find((e) => e.name === "yahoo")!;
    // Both share provider "bing" — duck succeeds so yahoo is dedup-skipped
    const html = `<div class="body"><h2>Title</h2><a href="https://example.com">body</a></div>`;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(html, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const results = await autoTextSearch("hello", 5, 5000, undefined, [
      duck,
      yahoo,
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results.length).toBeGreaterThan(0);
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
});

// ── createUnslothProvider ────────────────────────────────────────────────

function makeProvider(
  overrides: Partial<Parameters<typeof createUnslothProvider>[0]> = {},
) {
  return createUnslothProvider({
    timeoutMs: 5000,
    overallTimeoutMs: 8000,
    region: "us-en",
    safesearch: "moderate",
    engines: ["duckduckgo"],
    ...overrides,
  });
}

function abortableFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

function abortOnSignal2(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

function timeoutFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("timed out", "TimeoutError"));
    });
  });
}

describe("createUnslothProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has name unsloth and usageNotes", () => {
    const provider = makeProvider();
    expect(provider.name).toBe("unsloth");
    expect(provider.usageNotes).toContain("duckduckgo");
  });

  it("throws Request aborted when signal already aborted", async () => {
    const provider = makeProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.search({ query: "hello" }, controller.signal),
    ).rejects.toThrow("Request aborted");
  });

  it("propagates abort when signal fires mid-flight", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(abortableFetch));
    const provider = makeProvider({ overallTimeoutMs: 5000 });
    const controller = new AbortController();
    const promise = provider.search({ query: "hello" }, controller.signal);
    await Promise.resolve();
    controller.abort();
    try {
      await promise;
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe("AbortError");
    }
  });

  it("throws Request timed out when overall timeout fires", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(timeoutFetch));
    const provider = makeProvider({ overallTimeoutMs: 10, timeoutMs: 5000 });
    await expect(provider.search({ query: "hello" })).rejects.toThrow(
      "Request timed out",
    );
  });

  it("returns undefined on empty sweep", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    const provider = makeProvider();
    const result = await provider.search({ query: "hello" });
    expect(result).toBeUndefined();
  });

  it("caps to numResults and appends IMPORTANT trailer", async () => {
    const html = [
      `<div class="body"><h2>One</h2><a href="https://a.com">hello world one body</a></div>`,
      `<div class="body"><h2>Two</h2><a href="https://b.com">hello world two body</a></div>`,
      `<div class="body"><h2>Three</h2><a href="https://c.com">hello world three body</a></div>`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const provider = makeProvider();
    const result = await provider.search({
      query: "hello world",
      numResults: 2,
    });
    expect(result).toBeDefined();
    const count = (result ?? "").split("\nTitle:").length;
    // First block starts with "Title:", subsequent are "\nTitle:" after split we count segments
    // With 2 results we expect 2 Title: occurrences
    expect((result ?? "").split("Title:").length - 1).toBe(2);
    expect(result).toContain("URL:");
    expect(result).toContain("Snippet:");
    expect(result).toContain("IMPORTANT:");
    expect(count).toBe(2);
  });

  it("uses overallTimeoutMs vs timeoutMs separately", async () => {
    // Per-engine timeout throws "timed out" immediately
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    const provider = makeProvider({ timeoutMs: 5, overallTimeoutMs: 5000 });
    await expect(provider.search({ query: "hello" })).rejects.toThrow(
      "Request timed out",
    );
  });

  it("cleans up timeout on success", async () => {
    const html = `<div class="body"><h2>Hi</h2><a href="https://example.com">hello world body</a></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const provider = makeProvider();
    await provider.search({ query: "hello world" });
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe("formatSearchResults", () => {
  it("formats Title/URL/Snippet blocks with IMPORTANT trailer", () => {
    const text = formatSearchResults([
      { title: "A", href: "https://a.com", body: "body a" },
      { title: "B", href: "https://b.com", body: "body b" },
    ]);
    expect(text).toContain("Title: A");
    expect(text).toContain("URL: https://a.com");
    expect(text).toContain("Snippet: body a");
    expect(text).toContain("---");
    expect(text).toContain("IMPORTANT:");
  });
});

// ── coverage: error paths, edge parser, safesearch/region variants, helpers ──

describe("coverage gaps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizeText handles control chars and entities", () => {
    // Control chars are stripped
    expect(normalizeText("a\u0000 b")).not.toContain("\u0000");
    // Large codepoint branch: hex entity > 10ffff -> FFFD
    expect(normalizeText("a&#x110000; b")).toContain("\uFFFD");
    expect(normalizeText("a&#xD800; b")).toContain("\uFFFD");
    expect(normalizeText("a&#9999999; b")).toBeDefined();
  });

  it("normalizeUrl handles encoded spaces", () => {
    expect(normalizeUrl("https://a.com/x%20y")).toBe("https://a.com/x+y");
    expect(normalizeUrl("https://a.com/x y")).toBe("https://a.com/x+y");
  });

  it("SearchCancelled has correct name", () => {
    const e = new SearchCancelled();
    expect(e.name).toBe("SearchCancelled");
    expect(e.message).toBe("cancelled");
  });

  it("collectSearchError covers all branches", () => {
    // AbortError -> shouldThrow true
    const abort = new DOMException("aborted", "AbortError");
    expect(collectSearchError(abort)?.shouldThrow).toBe(true);
    // timed out -> shouldThrow true
    expect(collectSearchError(new Error("timed out"))?.shouldThrow).toBe(true);
    // signal aborted with Error -> shouldThrow true
    const ctrl = new AbortController();
    ctrl.abort();
    expect(
      collectSearchError(new Error("other"), ctrl.signal)?.shouldThrow,
    ).toBe(true);
    // signal aborted without err -> shouldThrow true
    expect(collectSearchError(null, ctrl.signal)?.shouldThrow).toBe(true);
    // err without signal abort -> returns shouldThrow false
    expect(collectSearchError(new Error("other"))?.shouldThrow).toBe(false);
    // no err, no signal -> null
    expect(collectSearchError(null)).toBeNull();
    expect(collectSearchError(undefined)).toBeNull();
  });

  it("shuffleEnginesWithPriority cycles through all", () => {
    for (let i = 0; i < 10; i++) {
      const out = shuffleEnginesWithPriority([...TEXT_ENGINES]);
      expect(out[0].name).toBe("wikipedia");
      expect(out).toHaveLength(7);
    }
  });

  it("parsePath handles ./ and attribute terminals", () => {
    const html = `<div><a href="https://example.com" title="t">x</a></div>`;
    const root = buildDom(html);
    const a = xpathNodes("//a", root)[0]!;
    expect(xpathText("./@href", a)[0]).toBe("https://example.com");
    expect(xpathText("./@title", a)[0]).toBe("t");
    // .// descendant from root
    expect(xpathText(".//a/@href", root)[0]).toBe("https://example.com");
  });

  it("xpath handles // and breaks", () => {
    const html = `<div><p>hi</p></div>`;
    const root = buildDom(html);
    expect(xpathNodes("//section", root)).toHaveLength(0);
    expect(xpathText("//p//text()", root).join("")).toBe("hi");
    // xpathNodes break on terminal
    const nodes = xpathNodes("//a/@href", root);
    expect(nodes).toHaveLength(0);
    // xpathText with no match
    expect(xpathText("//missing//text()", root)).toEqual([]);
  });

  it("extractResults handles empty snippet", () => {
    const html = `<div class="body"><h2></h2><a href=""> </a></div>`;
    const results = extractResults(html, "//div[contains(@class, 'body')]", {
      title: ".//h2//text()",
      href: "./a/@href",
      body: "./a//text()",
    });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("");
  });

  it("brave with safesearch on", async () => {
    const brave = TEXT_ENGINES.find((e) => e.name === "brave")!;
    const html = `<div data-type="web"><a href="https://b.com"><div class="title">T</div></a><div class="snippet"><div class="content">c</div></div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await brave.search(
      "hello",
      { region: "us-en", safesearch: "on" },
      5000,
    );
    expect(results).toHaveLength(1);
  });

  it("brave with safesearch off", async () => {
    const brave = TEXT_ENGINES.find((e) => e.name === "brave")!;
    const html = `<div data-type="web"><a href="https://b.com"><div class="title">T</div></a><div class="snippet"><div class="content">c</div></div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await brave.search(
      "hello",
      { region: "us-en", safesearch: "off" },
      5000,
    );
    expect(results).toHaveLength(1);
  });

  it("mojeek with safesearch on", async () => {
    const mojeek = TEXT_ENGINES.find((e) => e.name === "mojeek")!;
    const html = `<ul class="results"><li><h2><a href="https://m.com">T</a></h2><p class="s">s</p></li></ul>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const results = await mojeek.search(
      "hello",
      { region: "us-en", safesearch: "on" },
      5000,
    );
    expect(results).toHaveLength(1);
  });

  it("wikipedia handles JSON parse failure", async () => {
    const wiki = TEXT_ENGINES.find((e) => e.name === "wikipedia")!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
    );
    const r = await wiki.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(r).toBeNull();
  });

  it("wikipedia handles opensearch empty", async () => {
    const wiki = TEXT_ENGINES.find((e) => e.name === "wikipedia")!;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(["hello", [], [], []]), { status: 200 }),
        ),
    );
    const r = await wiki.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(r).toEqual([]);
  });

  it("wikipedia handles opensearch parse null then extract catch", async () => {
    const wiki = TEXT_ENGINES.find((e) => e.name === "wikipedia")!;
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve(
            new Response(
              JSON.stringify([
                "hello",
                ["Hello"],
                ["desc"],
                ["https://en.wikipedia.org/wiki/Hello"],
              ]),
              {
                status: 200,
              },
            ),
          );
        }
        return Promise.resolve(new Response("not json", { status: 200 }));
      }),
    );
    const r = await wiki.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(r).toHaveLength(1);
  });

  it("wikipedia null on fetch failure", async () => {
    const wiki = TEXT_ENGINES.find((e) => e.name === "wikipedia")!;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 500 })),
    );
    const r = await wiki.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(r).toBeNull();
  });

  it("yahoo with https RU", async () => {
    const yahoo = TEXT_ENGINES.find((e) => e.name === "yahoo")!;
    const html = `<div class="relsrch"><div class="Title"><h3><a href="https://r.search.yahoo.com/RU=https%3A%2F%2Fa.com/RK=x">T</a></h3></div><div class="Text">b</div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const r = await yahoo.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(r![0].href).toBe("https://a.com");
  });

  it("unquotePlus handles decode error", async () => {
    const yahoo = TEXT_ENGINES.find((e) => e.name === "yahoo")!;
    const html = `<div class="relsrch"><div class="Title"><h3><a href="https://r.search.yahoo.com/RU=%ZZ/RK=x">T</a></h3></div><div class="Text">b</div></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const r = await yahoo.search(
      "hello",
      { region: "us-en", safesearch: "moderate" },
      5000,
    );
    expect(r).toHaveLength(1);
  });

  it("createUnslothProvider with empty filtered engines", async () => {
    const provider = createUnslothProvider({
      timeoutMs: 5000,
      overallTimeoutMs: 5000,
      region: "us-en",
      safesearch: "moderate",
      engines: [],
    });
    const r = await provider.search({ query: "hello" });
    expect(r).toBeUndefined();
  });

  it("predicate parser error paths", () => {
    expect(() =>
      extractResults("<div></div>", "//div[@]", {
        title: "./@x",
        href: "./@y",
        body: "./@z",
      }),
    ).toThrow();
    expect(() =>
      extractResults("<div></div>", "//div[contains(@class, 'x'", {
        title: "./@x",
        href: "./@y",
        body: "./@z",
      }),
    ).toThrow();
    // Unclosed bracket with quote handling: depth++ path, then throw on bad predicate
    expect(() =>
      extractResults("<div></div>", "//div[contains(@class, 'a[b]')]", {
        title: ".//h2//text()",
        href: "./@href",
        body: "./@href",
      }),
    ).not.toThrow();
  });

  it("aggregator early break and pending drain in runUnslothSearch", async () => {
    const duckHtml = `<div class="body"><h2>Hi</h2><a href="https://example.com">hello world body</a></div>`;
    const braveHtml = `<div data-type="web"><a href="https://b.com"><div class="title">T</div></a><div class="snippet"><div class="content">hello world c</div></div></div>`;
    const html = `${duckHtml}${braveHtml}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const provider = createUnslothProvider({
      timeoutMs: 5000,
      overallTimeoutMs: 8000,
      region: "us-en",
      safesearch: "moderate",
      engines: ["duckduckgo", "brave"],
    });
    const result = await provider.search({
      query: "hello world",
      numResults: 1,
    });
    expect(result).toBeDefined();
    expect(result).toContain("Title:");
  });

  it("provider dedup continue path", async () => {
    // duck and yahoo share provider "bing" -> second is skipped via continue
    const duckHtml = `<div class="body"><h2>Hi</h2><a href="https://example.com">hello world body</a></div>`;
    const yahooHtml = `<div class="relsrch"><div class="Title"><h3><a href="https://a.com">Hi</a></h3></div><div class="Text">b</div></div>`;
    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      // yahoo and duck share provider "bing" -> only one should contribute
      // but shuffle is non-deterministic, so either may run first
      const isDuck = typeof url === "string" && url.includes("duckduckgo");
      const html = isDuck ? duckHtml : yahooHtml;
      return Promise.resolve(new Response(html, { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createUnslothProvider({
      timeoutMs: 5000,
      overallTimeoutMs: 8000,
      region: "us-en",
      safesearch: "moderate",
      engines: ["duckduckgo", "yahoo"],
    });
    const result = await provider.search({
      query: "hello world",
      numResults: 5,
    });
    expect(result).toBeDefined();
    // Exactly one fetch: yahoo and duck share provider "bing", second is skipped
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("collectSearchError abort without err via perEngineSignal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(abortOnSignal2));
    const provider = createUnslothProvider({
      timeoutMs: 5000,
      overallTimeoutMs: 10,
      region: "us-en",
      safesearch: "moderate",
      engines: ["duckduckgo"],
    });
    await expect(provider.search({ query: "hello" })).rejects.toThrow();
  });

  it("parsePath edge terminals and predicates", () => {
    // Covers parsePath i++ paths, @ terminal, and break on bad name
    const html = `<div><a href="https://a.com" data-x="v">x</a><p>hi</p></div>`;
    const root = buildDom(html);
    // text() terminal
    expect(xpathText("//a//text()", root).join("")).toBe("x");
    // @href terminal
    expect(xpathText("//a/@href", root)[0]).toBe("https://a.com");
    // with predicate containing quote
    expect(xpathNodes("//a[@data-x='v']", root)).toHaveLength(1);
    // contains(@class, ...) predicate
    const html2 = `<div class="foo bar">x</div>`;
    const root2 = buildDom(html2);
    expect(xpathNodes("//div[contains(@class, 'foo')]", root2)).toHaveLength(1);
  });

  it("xpathNodes terminal break path", () => {
    const html = `<div><a href="https://a.com">x</a></div>`;
    const root = buildDom(html);
    // xpathNodes with terminal like @href breaks before resolving terminal, returns matched element nodes
    const nodes = xpathNodes("//a/@href", root);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].tag).toBe("a");
  });

  it("xpathText covers ApplyStep with name filter", () => {
    const html = `<section><div class="body"><h2>T</h2></div><span>skip</span></section>`;
    const results = extractResults(
      html,
      "//section//div[contains(@class, 'body')]",
      {
        title: ".//h2//text()",
        href: "./@href",
        body: "./@href",
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("T");
  });

  it("autoTextSearch break via aggregator size >= maxResults", async () => {
    const html = `<div class="body"><h2>Hi</h2><a href="https://example.com">hello world body</a></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    // 2 engines of different providers, maxResults=1 -> first fills aggregator, second batch breaks
    const result = await autoTextSearch("hello world", 1, 5000, undefined, [
      TEXT_ENGINES.find((e) => e.name === "duckduckgo")!,
      TEXT_ENGINES.find((e) => e.name === "brave")!,
      TEXT_ENGINES.find((e) => e.name === "google")!,
    ]);
    expect(result).toHaveLength(1);
  });

  it("autoTextSearch pending drain", async () => {
    const html = `<div class="body"><h2>Hi</h2><a href="https://example.com">hello world body</a></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(html, { status: 200 })),
    );
    const duck = TEXT_ENGINES.find((e) => e.name === "duckduckgo")!;
    const result = await autoTextSearch("hello world", 5, 5000, undefined, [
      duck,
    ]);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!process.env.LIVE)("unsloth live", () => {
  it("returns at least one result for a real query", async () => {
    const { createProvider } = await import("../../src/lib/providers");
    const provider = createProvider({
      provider: "unsloth",
      exaMcp: { url: "https://mcp.exa.ai/mcp", tool: "web_search_exa" },
      searxng: { url: "http://localhost:8080", safesearch: 0 },
      timeoutMs: 15_000,
      defaults: {
        numResults: 5,
        type: "auto",
        livecrawl: "fallback",
        contextMaxCharacters: 10_000,
      },
    } as unknown as import("../../src/config").WebsearchConfig);
    const result = await provider.search({ query: "pi coding agent" });
    expect(result).toBeDefined();
    expect(result).toContain("Title:");
    expect(result).toContain("URL:");
    expect(result).toContain("Snippet:");
    expect(result).toContain("IMPORTANT:");
  });
});
