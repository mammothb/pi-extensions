import { randomBytes } from "node:crypto";
import { Parser } from "htmlparser2";
import { formatSearchResults as sharedFormatSearchResults } from "../format";

// ── Normalizers (port of engines.ts) ──────────────────────────────────────

const STRIP_TAGS_RE = /<.*?>/g;

/**
 * Minimal HTML entity decoder for the snippet paths.
 * htmlparser2 already decodes entities in buildDom; this handles any leftover
 * encoded fragments in title/body strings to match upstream parity.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);?/g, (_m: string, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      if (Number.isNaN(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return "\uFFFD";
      }
      return String.fromCodePoint(cp);
    })
    .replace(/&#(\d+);?/g, (_m: string, dec: string) => {
      const cp = Number.parseInt(dec, 10);
      if (Number.isNaN(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return "\uFFFD";
      }
      return String.fromCodePoint(cp);
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function normalizeText(raw: string): string {
  if (!raw) {
    return "";
  }
  let text = raw.replace(STRIP_TAGS_RE, "");
  text = decodeHtmlEntities(text);
  text = text.normalize("NFC");
  // Preserve word boundaries: whitespace controls become spaces before stripping remaining controls
  text = text.replace(/[\t\n\r]/g, " ");
  text = text.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}]/gu, "");
  return text.trim().split(/\s+/).join(" ");
}

export function normalizeUrl(url: string): string {
  if (!url) {
    return "";
  }
  try {
    return decodeURIComponent(url).replace(/ /g, "+");
  } catch {
    return url.replace(/ /g, "+");
  }
}

// ── DomNode + htmlparser2 adapter ─────────────────────────────────────────

export interface DomNode {
  tag: string;
  attrs: Record<string, string>;
  children: DomNode[];
  textNodes: string[];
}

export interface SearchResult {
  title: string;
  href: string;
  body: string;
}

export function buildDom(html: string): DomNode {
  const root: DomNode = {
    tag: "#root",
    attrs: {},
    children: [],
    textNodes: [],
  };
  const stack: DomNode[] = [root];
  const pushText = (text: string) => {
    for (const el of stack) {
      el.textNodes.push(text);
    }
  };
  const parser = new Parser(
    {
      onopentag(name: string, attribs: Record<string, string>) {
        const el: DomNode = {
          tag: name,
          attrs: { ...attribs },
          children: [],
          textNodes: [],
        };
        // biome-ignore lint/style/noNonNullAssertion: stack always has root
        stack[stack.length - 1]!.children.push(el);
        stack.push(el);
      },
      ontext(data: string) {
        pushText(data);
      },
      onclosetag(name: string) {
        for (let i = stack.length - 1; i >= 1; i--) {
          // biome-ignore lint/style/noNonNullAssertion: i in bounds
          if (stack[i]!.tag === name) {
            stack.length = i;
            return;
          }
        }
      },
      oncomment() {},
    },
    {
      decodeEntities: true,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
    },
  );
  parser.write(html);
  parser.end();
  return root;
}

// ── XPath subset (verbatim port of engines.ts) ────────────────────────────

type Pred =
  | { op: "or"; a: Pred; b: Pred }
  | { op: "and"; a: Pred; b: Pred }
  | { op: "last" }
  | { op: "class-contains"; value: string }
  | { op: "attr-eq"; name: string; value: string }
  | { op: "has-attr"; name: string }
  | { op: "desc"; tag: string }
  | { op: "child"; tag: string; preds: Pred[] };

type XStep =
  | { kind: "node"; axis: "descendant" | "child"; name?: string; preds: Pred[] }
  | { kind: "text" }
  | { kind: "attr"; name: string };

function skipWhitespace(input: string, pos: { value: number }): void {
  while (pos.value < input.length && /\s/.test(input[pos.value] as string)) {
    pos.value++;
  }
}

function expectChar(
  input: string,
  pos: { value: number },
  char: string,
  what: string,
): void {
  skipWhitespace(input, pos);
  if (input[pos.value] !== char) {
    throw new Error(`bad predicate ${what}: ${input}`);
  }
  pos.value++;
}

function readWord(input: string, pos: { value: number }): string {
  skipWhitespace(input, pos);
  const m = /^[A-Za-z][A-Za-z0-9_-]*/.exec(input.slice(pos.value));
  if (!m) {
    throw new Error(`bad predicate: ${input}`);
  }
  pos.value += m[0].length;
  return m[0];
}

function readQuoted(input: string, pos: { value: number }): string {
  skipWhitespace(input, pos);
  const quote = input[pos.value] as string;
  if (quote !== "'" && quote !== '"') {
    throw new Error(`bad predicate quote: ${input}`);
  }
  pos.value++;
  const end = input.indexOf(quote, pos.value);
  if (end === -1) {
    throw new Error(`bad predicate quote: ${input}`);
  }
  const value = input.slice(pos.value, end);
  pos.value = end + 1;
  return value;
}

function parsePredBlocks(input: string, pos: { value: number }): Pred[] {
  const preds: Pred[] = [];
  while (pos.value < input.length && input[pos.value] === "[") {
    const start = pos.value + 1;
    let depth = 1;
    let quote: string | null = null;
    let i = start;
    while (i < input.length && depth) {
      const c = input[i];
      if (quote !== null) {
        if (c === quote) {
          quote = null;
        }
      } else if (c === "'" || c === '"') {
        quote = c as string;
      } else if (c === "[") {
        depth++;
      } else if (c === "]") {
        depth--;
      }
      i++;
    }
    const inner = input.slice(start, i - 1);
    preds.push(parsePredExpr(inner));
    pos.value = i;
  }
  return preds;
}

function parseParenAtom(
  input: string,
  pos: { value: number },
  parseOr: () => Pred,
): Pred {
  pos.value++;
  const inner = parseOr();
  expectChar(input, pos, ")", "paren");
  return inner;
}

function parseClassContainsAtom(input: string, pos: { value: number }): Pred {
  pos.value += "contains(@class,".length;
  const value = readQuoted(input, pos);
  expectChar(input, pos, ")", "contains");
  return { op: "class-contains", value };
}

function parseAttrAtom(input: string, pos: { value: number }): Pred {
  pos.value++;
  const name = readWord(input, pos);
  skipWhitespace(input, pos);
  if (input[pos.value] === "=") {
    pos.value++;
    const value = readQuoted(input, pos);
    return { op: "attr-eq", name, value };
  }
  return { op: "has-attr", name };
}

function parseAtom(
  input: string,
  pos: { value: number },
  parseOr: () => Pred,
): Pred {
  skipWhitespace(input, pos);
  if (input[pos.value] === "(") {
    return parseParenAtom(input, pos, parseOr);
  }
  if (input.startsWith("position()=last()", pos.value)) {
    pos.value += "position()=last()".length;
    return { op: "last" };
  }
  if (input.startsWith("contains(@class,", pos.value)) {
    return parseClassContainsAtom(input, pos);
  }
  if (input[pos.value] === "@") {
    return parseAttrAtom(input, pos);
  }
  if (input.startsWith(".//", pos.value)) {
    pos.value += 3;
    const name = readWord(input, pos);
    return { op: "desc", tag: name };
  }
  const name = readWord(input, pos);
  const preds = parsePredBlocks(input, pos);
  return { op: "child", tag: name, preds };
}

function parsePredExpr(input: string): Pred {
  const pos = { value: 0 };
  const atom = (): Pred => parseAtom(input, pos, parseOr);
  const parseAnd = (): Pred => {
    let left = atom();
    while (true) {
      while (
        pos.value < input.length &&
        /\s/.test(input[pos.value] as string)
      ) {
        pos.value++;
      }
      if (
        input.startsWith("and", pos.value) &&
        !/\w/.test(input[pos.value + 3] ?? "")
      ) {
        pos.value += 3;
        left = { op: "and", a: left, b: atom() };
      } else {
        return left;
      }
    }
  };
  const parseOr = (): Pred => {
    let left = parseAnd();
    while (true) {
      while (
        pos.value < input.length &&
        /\s/.test(input[pos.value] as string)
      ) {
        pos.value++;
      }
      if (
        input.startsWith("or", pos.value) &&
        !/\w/.test(input[pos.value + 2] ?? "")
      ) {
        pos.value += 2;
        left = { op: "or", a: left, b: parseAnd() };
      } else {
        return left;
      }
    }
  };
  return parseOr();
}

const NODE_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*/;
const ATTR_NAME_RE = /^[A-Za-z0-9_-]+/;

function parsePathStart(expr: string): {
  index: number;
  axis: "child" | "descendant";
} {
  if (expr.startsWith("//")) {
    return { index: 2, axis: "descendant" };
  }
  if (expr.startsWith("./")) {
    return expr[2] === "/"
      ? { index: 3, axis: "descendant" }
      : { index: 2, axis: "child" };
  }
  return { index: 0, axis: "child" };
}

function readAttrStep(
  expr: string,
  index: number,
): { step: XStep; next: number } {
  const m = ATTR_NAME_RE.exec(expr.slice(index));
  return {
    step: { kind: "attr", name: m ? m[0] : "" },
    next: m ? index + m[0].length : index,
  };
}

function parseSlashToken(
  expr: string,
  i: number,
): { i: number; axis: "child" | "descendant" } {
  const double = expr[i + 1] === "/";
  return {
    i: double ? i + 2 : i + 1,
    axis: double ? "descendant" : "child",
  };
}

function parseAttrToken(
  expr: string,
  i: number,
  steps: XStep[],
): { i: number } {
  const attr = readAttrStep(expr, i + 1);
  steps.push(attr.step);
  return { i: attr.next };
}

function parseTextToken(steps: XStep[]): { i: number } {
  steps.push({ kind: "text" });
  return { i: "text()".length };
}

function parseNameToken(
  expr: string,
  i: number,
  axis: "child" | "descendant",
  steps: XStep[],
): { i: number } | null {
  const m = NODE_NAME_RE.exec(expr.slice(i));
  if (!m) {
    return null;
  }
  const pos = { value: i + m[0].length };
  const preds = parsePredBlocks(expr, pos);
  steps.push({ kind: "node", axis, name: m[0], preds });
  return { i: pos.value };
}

function parseNextToken(
  expr: string,
  i: number,
  axis: "child" | "descendant",
  steps: XStep[],
): { i: number; axis?: "child" | "descendant" } | null {
  const ch = expr[i];
  if (ch === "/") {
    return parseSlashToken(expr, i);
  }
  if (ch === ".") {
    return { i: i + 1 };
  }
  if (ch === "@") {
    return parseAttrToken(expr, i, steps);
  }
  if (expr.startsWith("text()", i)) {
    const text = parseTextToken(steps);
    return { i: i + text.i };
  }
  return parseNameToken(expr, i, axis, steps);
}

function parsePath(expr: string): XStep[] {
  const steps: XStep[] = [];
  const start = parsePathStart(expr);
  let i = start.index;
  let axis = start.axis;
  while (i < expr.length) {
    const tok = parseNextToken(expr, i, axis, steps);
    if (!tok) {
      break;
    }
    i = tok.i;
    if (tok.axis !== undefined) {
      axis = tok.axis;
    }
  }
  return steps;
}

function hasDescendantWithTag(node: DomNode, tag: string): boolean {
  const stack: DomNode[] = [...node.children];
  while (stack.length) {
    // biome-ignore lint/style/noNonNullAssertion: stack non-empty (length checked)
    const cur = stack.pop()!;
    if (cur.tag === tag) {
      return true;
    }
    for (let i = cur.children.length - 1; i >= 0; i--) {
      // biome-ignore lint/style/noNonNullAssertion: i < cur.children.length
      stack.push(cur.children[i]!);
    }
  }
  return false;
}

function collectDescendants(el: DomNode, out: DomNode[]): void {
  for (const child of el.children) {
    out.push(child);
    collectDescendants(child, out);
  }
}

function matchesPred(
  pred: Pred,
  el: DomNode,
  index: number,
  total: number,
): boolean {
  switch (pred.op) {
    case "or": {
      return (
        matchesPred(pred.a, el, index, total) ||
        matchesPred(pred.b, el, index, total)
      );
    }
    case "and": {
      return (
        matchesPred(pred.a, el, index, total) &&
        matchesPred(pred.b, el, index, total)
      );
    }
    case "last": {
      return index === total - 1;
    }
    case "class-contains": {
      // biome-ignore lint/complexity/useLiteralKeys: attrs is Record<string,string>
      return (el.attrs["class"] ?? "").includes(pred.value);
    }
    case "attr-eq": {
      return el.attrs[pred.name] === pred.value;
    }
    case "has-attr": {
      return pred.name in el.attrs;
    }
    case "desc": {
      return el.tag === pred.tag || hasDescendantWithTag(el, pred.tag);
    }
    case "child": {
      return el.children.some(
        (c) =>
          c.tag === pred.tag &&
          pred.preds.every((p) => matchesPred(p, c, 0, 1)),
      );
    }
  }
}

function descendantsOf(el: DomNode): DomNode[] {
  const out: DomNode[] = [];
  collectDescendants(el, out);
  return out;
}

function collectCandidates(
  step: Extract<XStep, { kind: "node" }>,
  nodes: DomNode[],
): DomNode[] {
  const candidates: DomNode[] = [];
  for (const node of nodes) {
    const source = step.axis === "child" ? node.children : descendantsOf(node);
    for (const child of source) {
      if (!step.name || child.tag === step.name) {
        candidates.push(child);
      }
    }
  }
  return candidates;
}

function dedupeNodes(nodes: DomNode[]): DomNode[] {
  const seen = new Set<DomNode>();
  const deduped: DomNode[] = [];
  for (const node of nodes) {
    if (!seen.has(node)) {
      seen.add(node);
      deduped.push(node);
    }
  }
  return deduped;
}

function applyStep(
  step: Extract<XStep, { kind: "node" }>,
  nodes: DomNode[],
): DomNode[] {
  const deduped = dedupeNodes(collectCandidates(step, nodes));
  const total = deduped.length;
  return deduped.filter((el, index) =>
    step.preds.every((p) => matchesPred(p, el, index, total)),
  );
}

export function xpathText(expr: string, node: DomNode): string[] {
  const steps = parsePath(expr);
  let nodes: DomNode[] = [node];
  for (const step of steps) {
    if (step.kind === "text") {
      const out: string[] = [];
      for (const n of nodes) {
        out.push(...n.textNodes);
      }
      return out;
    }
    if (step.kind === "attr") {
      return nodes.map((n) => n.attrs[step.name] ?? "");
    }
    nodes = applyStep(step, nodes);
  }
  return [];
}

export function xpathNodes(expr: string, root: DomNode): DomNode[] {
  const steps = parsePath(expr);
  let nodes: DomNode[] = [root];
  for (const step of steps) {
    if (step.kind !== "node") {
      break;
    }
    nodes = applyStep(step, nodes);
  }
  return nodes;
}

export function extractResults(
  html: string,
  itemsXpath: string,
  elementsXpath: { title: string; href: string; body: string },
): SearchResult[] {
  const root = buildDom(html);
  const items = xpathNodes(itemsXpath, root);
  const results: SearchResult[] = [];
  for (const item of items) {
    const result: SearchResult = { title: "", href: "", body: "" };
    const entries = [
      ["title", elementsXpath.title],
      ["href", elementsXpath.href],
      ["body", elementsXpath.body],
    ] as const;
    for (const [key, value] of entries) {
      const data = xpathText(value, item)
        .join("")
        .trim()
        .split(/\s+/)
        .join(" ");
      if (!data) {
        continue;
      }
      result[key] = key === "href" ? normalizeUrl(data) : normalizeText(data);
    }
    results.push(result);
  }
  return results;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class EmptySweepError extends Error {
  constructor() {
    super("No results found");
    this.name = "EmptySweepError";
  }
}

export class SearchTimeoutError extends Error {
  constructor() {
    super("timed out");
    this.name = "SearchTimeoutError";
  }
}

export class SearchCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "SearchCancelled";
  }
}

// ── Aggregator + Ranker (port of engines.ts) ────────────────────────────────

export class ResultsAggregator {
  private readonly cache = new Map<string, SearchResult>();
  private readonly counter = new Map<string, number>();

  get size(): number {
    return this.cache.size;
  }

  append(item: SearchResult): void {
    const key = item.href;
    if (!key) {
      return;
    }
    const existing = this.cache.get(key);
    if (!existing || item.body.length > existing.body.length) {
      this.cache.set(key, item);
    }
    this.counter.set(key, (this.counter.get(key) ?? 0) + 1);
  }

  extend(items: SearchResult[]): void {
    for (const item of items) {
      this.append(item);
    }
  }

  extractDicts(): SearchResult[] {
    return (
      [...this.counter.entries()]
        .sort((a, b) => b[1] - a[1])
        // biome-ignore lint/style/noNonNullAssertion: explanation
        .map(([key]) => this.cache.get(key)!)
    );
  }
}

function extractTokens(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/\W+/u)
      .filter((t) => t.length >= 3),
  );
}

function hasAnyToken(text: string, tokens: Set<string>): boolean {
  const lower = text.toLowerCase();
  for (const token of tokens) {
    if (lower.includes(token)) {
      return true;
    }
  }
  return false;
}

export function rankResults(
  docs: SearchResult[],
  query: string,
): SearchResult[] {
  const tokens = extractTokens(query);
  const wiki: SearchResult[] = [];
  const both: SearchResult[] = [];
  const titleOnly: SearchResult[] = [];
  const bodyOnly: SearchResult[] = [];
  const neither: SearchResult[] = [];
  for (const doc of docs) {
    if (doc.title.includes("Category:") && doc.title.includes("Wikimedia")) {
      continue;
    }
    if (doc.href.includes("wikipedia.org")) {
      wiki.push(doc);
      continue;
    }
    const hitTitle = hasAnyToken(doc.title, tokens);
    const hitBody = hasAnyToken(doc.body, tokens);
    if (hitTitle && hitBody) {
      both.push(doc);
    } else if (hitTitle) {
      titleOnly.push(doc);
    } else if (hitBody) {
      bodyOnly.push(doc);
    } else {
      neither.push(doc);
    }
  }
  return [...wiki, ...both, ...titleOnly, ...bodyOnly, ...neither];
}

// ── Engines ─────────────────────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
];

function randomUserAgent(): string {
  // biome-ignore lint/style/noNonNullAssertion: explanation
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

function googleUserAgent(): string {
  const devices: [string, string, number, number][] = [
    ["5.0", "SM-G900P Build/LRX21T", 39, 60],
    ["6.0", "Nexus 5 Build/MRA58N", 39, 60],
    ["8.0", "Pixel 2 Build/OPD3.170816.012", 39, 60],
  ];
  const [androidVer, device, chromeMin, chromeMax] =
    // biome-ignore lint/style/noNonNullAssertion: explanation
    devices[Math.floor(Math.random() * devices.length)]!;
  const chromeMajor =
    chromeMin + Math.floor(Math.random() * (chromeMax - chromeMin + 1));
  const chromeBuild = 1000 + Math.floor(Math.random() * 9000);
  const chromePatch = 1000 + Math.floor(Math.random() * 1000);
  return (
    `Mozilla/5.0 (Linux; Android ${androidVer}; ${device}) ` +
    `AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${chromeMajor}.0.${chromeBuild}.${chromePatch} Mobile Safari/537.36`
  );
}

function tokenUrlSafe(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function unquotePlus(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

function yahooExtractUrl(raw: string): string {
  const afterRu = raw.split("/RU=", 2)[1] ?? "";
  const t = afterRu.split("/RK=", 1)[0]?.split("/RS=", 1)[0] ?? "";
  return unquotePlus(t);
}

export interface EngineContext {
  region: string;
  safesearch: string;
}

export interface Engine {
  name: string;
  provider: string;
  priority?: number;
  search(
    query: string,
    ctx: EngineContext,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<SearchResult[] | null>;
}

async function httpGet(
  url: string,
  params: Record<string, string>,
  options: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return httpFetch(target.toString(), options);
}

async function httpPost(
  url: string,
  data: Record<string, string>,
  options: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(options.headers ?? {}),
  };
  return httpFetch(url, {
    ...options,
    headers,
    method: "POST",
    body: new URLSearchParams(data).toString(),
  });
}

async function httpFetch(
  url: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<string | null> {
  const headers: Record<string, string> = {
    "User-Agent": options.headers?.["User-Agent"] ?? randomUserAgent(),
    Accept: "*/*",
    ...options.headers,
  };
  const cookie = options.cookies
    ? Object.entries(options.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ")
    : null;
  if (cookie) {
    headers.Cookie = cookie;
  }
  const signals: AbortSignal[] = [AbortSignal.timeout(options.timeoutMs)];
  if (options.signal) {
    signals.push(options.signal);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.method === "POST" ? options.body : undefined,
      signal: AbortSignal.any(signals),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("timed out");
    }
    throw err;
  }
  if (response.status !== 200) {
    return null;
  }
  return response.text();
}

const DUCKDUCKGO: Engine = {
  name: "duckduckgo",
  provider: "bing",
  async search(query, ctx, timeoutMs, signal) {
    const html = await httpPost(
      "https://html.duckduckgo.com/html/",
      { q: query, b: "", l: ctx.region },
      { headers: { "User-Agent": randomUserAgent() }, timeoutMs, signal },
    );
    if (!html) {
      return null;
    }
    // Current markup nests the anchor inside h2.result__title and serves the
    // snippet via a.result__snippet; result__url would otherwise pollute body.
    const results = extractResults(html, "//div[contains(@class, 'body')]", {
      title: ".//h2//text()",
      href: ".//h2/a/@href",
      body: ".//a[contains(@class,'result__snippet')]//text()",
    });
    return results.filter(
      (r) => !r.href.startsWith("https://duckduckgo.com/y.js?"),
    );
  },
};

const BRAVE: Engine = {
  name: "brave",
  provider: "brave",
  async search(query, ctx, timeoutMs, signal) {
    // biome-ignore lint/style/noNonNullAssertion: explanation
    const country = ctx.region.toLowerCase().split("-")[0]!;
    const cookies: Record<string, string> = {
      [country]: country,
      useLocation: "0",
    };
    if (ctx.safesearch !== "moderate") {
      cookies.safesearch = ctx.safesearch === "on" ? "strict" : "off";
    }
    const html = await httpGet(
      "https://search.brave.com/search",
      { q: query, source: "web" },
      { cookies, timeoutMs, signal },
    );
    if (!html) {
      return null;
    }
    return extractResults(html, "//div[@data-type='web']", {
      title:
        ".//div[(contains(@class,'title') or contains(@class,'sitename-container')) and position()=last()]//text()",
      href: ".//a[div[contains(@class, 'title')]]/@href",
      body: ".//div[contains(@class, 'snippet')]//div[contains(@class, 'content')]//text()",
    });
  },
};

const GOOGLE: Engine = {
  name: "google",
  provider: "google",
  async search(query, ctx, timeoutMs, signal) {
    const parts = ctx.region.toLowerCase().split("-");
    const country = parts[0] ?? "us";
    const lang = parts[1] ?? "en";
    const safesearchBase: Record<string, string> = {
      on: "active",
      moderate: "active",
      off: "off",
    };
    const html = await httpGet(
      "https://www.google.com/search",
      {
        q: query,
        safe: safesearchBase[ctx.safesearch.toLowerCase()] ?? "active",
        start: "0",
        hl: `${lang}-${country.toUpperCase()}`,
        lr: `lang_${lang}`,
        cr: `country${country.toUpperCase()}`,
      },
      {
        headers: { "User-Agent": googleUserAgent() },
        cookies: { CONSENT: "YES+" },
        timeoutMs,
        signal,
      },
    );
    if (!html) {
      return null;
    }
    const results = extractResults(html, "//div[@data-hveid][.//h3]", {
      title: ".//h3//text()",
      href: ".//a[.//h3]/@href",
      body: "./div/div[last()]//text()",
    });
    return results
      .map((r) => {
        if (r.href.startsWith("/url?q=")) {
          r.href = r.href.split("?q=")[1]?.split("&")[0] ?? r.href;
        }
        return r;
      })
      .filter((r) => r.title && r.href.startsWith("http"));
  },
};

const MOJEEK: Engine = {
  name: "mojeek",
  provider: "mojeek",
  async search(query, ctx, timeoutMs, signal) {
    const parts = ctx.region.toLowerCase().split("-");
    const country = parts[0] ?? "us";
    const lang = parts[1] ?? "en";
    const params: Record<string, string> = { q: query };
    if (ctx.safesearch === "on") {
      params.safe = "1";
    }
    const html = await httpGet("https://www.mojeek.com/search", params, {
      cookies: { arc: country, lb: lang },
      timeoutMs,
      signal,
    });
    if (!html) {
      return null;
    }
    return extractResults(html, "//ul[contains(@class, 'results')]/li", {
      title: ".//h2//text()",
      href: ".//h2/a/@href",
      body: ".//p[@class='s']//text()",
    });
  },
};

const YAHOO: Engine = {
  name: "yahoo",
  provider: "bing",
  async search(query, _ctx, timeoutMs, signal) {
    const ylt = tokenUrlSafe(18);
    const ylu = tokenUrlSafe(35);
    const html = await httpGet(
      `https://search.yahoo.com/search;_ylt=${ylt};_ylu=${ylu}`,
      { p: query },
      { timeoutMs, signal },
    );
    if (!html) {
      return null;
    }
    const results = extractResults(html, "//div[contains(@class, 'relsrch')]", {
      title: ".//div[contains(@class, 'Title')]//h3//text()",
      href: ".//div[contains(@class, 'Title')]//a/@href",
      body: ".//div[contains(@class, 'Text')]//text()",
    });
    // Unwrap /RU= redirects BEFORE the ad filter: ads hide behind yahoo
    // redirects whose decoded target is a bing adclick URL.
    return results
      .map((r) => {
        if (r.href.includes("/RU=")) {
          r.href = yahooExtractUrl(r.href);
        }
        return r;
      })
      .filter((r) => !r.href.startsWith("https://www.bing.com/aclick?"));
  },
};

const YANDEX: Engine = {
  name: "yandex",
  provider: "yandex",
  async search(query, _ctx, timeoutMs, signal) {
    const searchid = String(1_000_000 + Math.floor(Math.random() * 9_000_000));
    const html = await httpGet(
      "https://yandex.com/search/site/",
      { text: query, web: "1", searchid },
      { timeoutMs, signal },
    );
    if (!html) {
      return null;
    }
    return extractResults(html, "//li[contains(@class, 'serp-item')]", {
      title: ".//h3//text()",
      href: ".//h3//a/@href",
      body: ".//div[contains(@class, 'text')]//text()",
    });
  },
};

const WIKIPEDIA: Engine = {
  name: "wikipedia",
  provider: "wikipedia",
  priority: 2,
  async search(query, ctx, timeoutMs, signal) {
    const lang = ctx.region.toLowerCase().split("-")[1] ?? "en";
    const encoded = encodeURIComponent(query);
    const opensearchUrl = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&profile=fuzzy&limit=1&search=${encoded}`;
    const opensearch = await httpGet(opensearchUrl, {}, { timeoutMs, signal });
    if (!opensearch) {
      return null;
    }
    let data: unknown;
    try {
      data = JSON.parse(opensearch);
    } catch {
      return null;
    }
    const payload = data as [string, string[], string[], string[]];
    if (!payload[1]?.length) {
      return [];
    }
    // biome-ignore lint/style/noNonNullAssertion: explanation
    const title = payload[1][0]!;
    // biome-ignore lint/style/noNonNullAssertion: explanation
    const href = payload[3][0]!;
    let body = "";
    const extractUrl =
      `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&prop=extracts` +
      `&titles=${encodeURIComponent(title)}&explaintext=0&exintro=0&redirects=1`;
    const extract = await httpGet(extractUrl, {}, { timeoutMs, signal });
    if (extract) {
      try {
        const pageData = JSON.parse(extract) as {
          query: { pages: Record<string, { extract?: string }> };
        };
        const pages = Object.values(pageData.query.pages);
        if (pages.length) {
          body = pages[0]?.extract ?? "";
        }
      } catch {
        body = "";
      }
    }
    if (body.includes("may refer to:")) {
      return [];
    }
    return [
      {
        title: normalizeText(title),
        href: normalizeUrl(href),
        body: normalizeText(body),
      },
    ];
  },
};

export const TEXT_ENGINES: Engine[] = [
  DUCKDUCKGO,
  BRAVE,
  GOOGLE,
  MOJEEK,
  YAHOO,
  YANDEX,
  WIKIPEDIA,
];

export function shuffleEnginesWithPriority(engines: Engine[]): Engine[] {
  const shuffled = [...engines];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // biome-ignore lint/style/noNonNullAssertion: indices in bounds
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!] as [
      Engine,
      Engine,
    ];
  }
  const wikipedia = shuffled.find((e) => e.priority === 2);
  const rest = shuffled.filter((e) => e.priority !== 2);
  return wikipedia ? [wikipedia, ...rest] : shuffled;
}

export function shuffledEngines(): Engine[] {
  return shuffleEnginesWithPriority(TEXT_ENGINES);
}

export function formatSearchResults(results: SearchResult[]): string {
  return sharedFormatSearchResults(results);
}

export interface UnslothConfig {
  timeoutMs: number;
  overallTimeoutMs: number;
  region: string;
  safesearch: "on" | "moderate" | "off";
  engines: import("../../config").UnslothEngineId[];
}

export function collectSearchError(
  err: unknown,
  signal?: AbortSignal,
): { shouldThrow: boolean; error: Error } | null {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { shouldThrow: true, error: err };
  }
  if (err instanceof Error && err.message.includes("timed out")) {
    return { shouldThrow: true, error: new Error("Request timed out") };
  }
  if (err instanceof Error && signal?.aborted) {
    return { shouldThrow: true, error: err };
  }
  if (signal?.aborted) {
    return {
      shouldThrow: true,
      error: new DOMException("The operation was aborted.", "AbortError"),
    };
  }
  return err ? { shouldThrow: false, error: err as Error } : null;
}

interface ScheduleResult {
  ranked: SearchResult[];
  err: unknown;
}

async function scheduleEngines(
  ordered: Engine[],
  query: string,
  ctx: EngineContext,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  maxResults: number,
): Promise<ScheduleResult> {
  const seenProviders = new Set<string>();
  const aggregator = new ResultsAggregator();
  let err: unknown = null;
  const uniqueProviders = new Set(ordered.map((e) => e.provider)).size;
  const maxWorkers = Math.min(uniqueProviders, Math.ceil(maxResults / 10) + 1);
  let i = 0;
  let pending: Promise<void>[] = [];
  const run = async (engine: Engine) => {
    try {
      const results = await engine.search(query, ctx, timeoutMs, signal);
      if (results?.length) {
        aggregator.extend(results);
        seenProviders.add(engine.provider);
      }
    } catch (e) {
      err = e;
    }
  };
  while (i < ordered.length) {
    if (aggregator.size >= maxResults) {
      break;
    }
    // biome-ignore lint/style/noNonNullAssertion: i < ordered.length
    const engine = ordered[i++]!;
    if (seenProviders.has(engine.provider)) {
      continue;
    }
    pending.push(run(engine));
    if (pending.length >= maxWorkers) {
      await Promise.allSettled(pending);
      pending = [];
    }
  }
  if (pending.length) {
    await Promise.allSettled(pending);
  }
  return { ranked: rankResults(aggregator.extractDicts(), query), err };
}

async function runUnslothSearch(
  filtered: Engine[],
  args: import("../types").SearchArgs,
  config: UnslothConfig,
  perEngineSignal: AbortSignal,
): Promise<string | undefined> {
  const ctx: EngineContext = {
    region: config.region,
    safesearch: config.safesearch,
  };
  const ordered = shuffleEnginesWithPriority(filtered);
  const maxResults = args.numResults ?? 8;
  const { ranked, err } = await scheduleEngines(
    ordered,
    args.query,
    ctx,
    config.timeoutMs,
    perEngineSignal,
    maxResults,
  );
  if (ranked.length) {
    return formatSearchResults(ranked.slice(0, maxResults));
  }
  const collected = collectSearchError(
    err,
    perEngineSignal as unknown as AbortSignal,
  );
  if (collected?.shouldThrow) {
    throw collected.error;
  }
  if (perEngineSignal.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  return undefined;
}

export function createUnslothProvider(
  config: UnslothConfig,
): import("../types").SearchProvider {
  const { overallTimeoutMs, engines } = config;
  return {
    name: "unsloth",
    usageNotes:
      "\n  - Results are fetched directly from 7 engines (duckduckgo, brave, google, mojeek, yahoo, yandex, wikipedia) with provider-deduplication and frequency ranking — no API key or Docker required",
    async search(
      args: import("../types").SearchArgs,
      signal?: AbortSignal,
    ): Promise<string | undefined> {
      if (signal?.aborted) {
        throw new Error("Request aborted");
      }
      const filtered = TEXT_ENGINES.filter((e) =>
        (engines as string[]).includes(e.name),
      );
      if (filtered.length === 0) {
        return undefined;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), overallTimeoutMs);
      const onAbort = () => controller.abort();
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      const perEngineSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;
      try {
        return await runUnslothSearch(filtered, args, config, perEngineSignal);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (controller.signal.aborted && !signal?.aborted) {
          throw new Error("Request timed out");
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    },
  };
}

export async function autoTextSearch(
  query: string,
  maxResults: number,
  timeoutMs: number,
  signal?: AbortSignal,
  engines: Engine[] = shuffledEngines(),
): Promise<SearchResult[]> {
  const ctx: EngineContext = { region: "us-en", safesearch: "moderate" };
  const { ranked, err } = await scheduleEngines(
    engines,
    query,
    ctx,
    timeoutMs,
    signal,
    maxResults,
  );
  if (ranked.length) {
    return ranked.slice(0, maxResults);
  }
  if (err instanceof Error && err.message.includes("timed out")) {
    throw new SearchTimeoutError();
  }
  throw new EmptySweepError();
}
