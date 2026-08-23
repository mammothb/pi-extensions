import { Parser } from "htmlparser2";

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

interface XStep {
  axis: "descendant" | "child";
  name?: string;
  preds: Pred[];
  terminal?: "text" | string;
}

function parsePredExpr(input: string): Pred {
  let pos = 0;
  const ws = () => {
    while (pos < input.length && /\s/.test(input[pos] as string)) {
      pos++;
    }
  };
  const word = () => {
    ws();
    const m = /^[A-Za-z][A-Za-z0-9_-]*/.exec(input.slice(pos));
    if (!m) {
      throw new Error(`bad predicate: ${input}`);
    }
    pos += m[0].length;
    return m[0];
  };
  const quoted = () => {
    ws();
    const quote = input[pos] as string;
    if (quote !== "'" && quote !== '"') {
      throw new Error(`bad predicate quote: ${input}`);
    }
    pos++;
    const end = input.indexOf(quote, pos);
    if (end === -1) {
      throw new Error(`bad predicate quote: ${input}`);
    }
    const value = input.slice(pos, end);
    pos = end + 1;
    return value;
  };
  const atom = (): Pred => {
    ws();
    if (input[pos] === "(") {
      pos++;
      const inner = parseOr();
      ws();
      if (input[pos] !== ")") {
        throw new Error(`bad predicate paren: ${input}`);
      }
      pos++;
      return inner;
    }
    if (input.startsWith("position()=last()", pos)) {
      pos += "position()=last()".length;
      return { op: "last" };
    }
    if (input.startsWith("contains(@class,", pos)) {
      pos += "contains(@class,".length;
      const value = quoted();
      ws();
      if (input[pos] !== ")") {
        throw new Error(`bad predicate contains: ${input}`);
      }
      pos++;
      return { op: "class-contains", value };
    }
    if (input[pos] === "@") {
      pos++;
      const name = word();
      ws();
      if (input[pos] === "=") {
        pos++;
        const value = quoted();
        return { op: "attr-eq", name, value };
      }
      return { op: "has-attr", name };
    }
    if (input.startsWith(".//", pos)) {
      pos += 3;
      const name = word();
      return { op: "desc", tag: name };
    }
    const name = word();
    const preds = parsePredBlocks();
    return { op: "child", tag: name, preds };
  };
  const parsePredBlocks = (): Pred[] => {
    const preds: Pred[] = [];
    while (pos < input.length && input[pos] === "[") {
      const start = pos + 1;
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
          quote = c;
        } else if (c === "[") {
          depth++;
        } else if (c === "]") {
          depth--;
        }
        i++;
      }
      const inner = input.slice(start, i - 1);
      preds.push(parsePredExpr(inner));
      pos = i;
    }
    return preds;
  };
  const parseAnd = (): Pred => {
    let left = atom();
    while (true) {
      ws();
      if (
        input.startsWith("and", pos) &&
        !/[A-Za-z0-9_]/.test(input[pos + 3] ?? "")
      ) {
        pos += 3;
        left = { op: "and", a: left, b: atom() };
      } else {
        return left;
      }
    }
  };
  const parseOr = (): Pred => {
    let left = parseAnd();
    while (true) {
      ws();
      if (
        input.startsWith("or", pos) &&
        !/[A-Za-z0-9_]/.test(input[pos + 2] ?? "")
      ) {
        pos += 2;
        left = { op: "or", a: left, b: parseAnd() };
      } else {
        return left;
      }
    }
  };
  return parseOr();
}

function parsePath(expr: string): XStep[] {
  const steps: XStep[] = [];
  let i = 0;
  let axis: "child" | "descendant" = "child";
  if (expr.startsWith("//")) {
    axis = "descendant";
    i = 2;
  } else if (expr.startsWith("./")) {
    i = 2;
    if (expr[i] === "/") {
      axis = "descendant";
      i++;
    }
  }
  while (i < expr.length) {
    if (expr[i] === "/") {
      if (expr[i + 1] === "/") {
        axis = "descendant";
        i += 2;
      } else {
        axis = "child";
        i++;
      }
      continue;
    }
    if (expr[i] === ".") {
      i++;
      continue;
    }
    if (expr[i] === "@") {
      i++;
      const m = /^[A-Za-z0-9_-]+/.exec(expr.slice(i));
      steps.push({ axis, preds: [], terminal: m ? m[0] : "" });
      i += m ? m[0].length : 0;
      continue;
    }
    if (expr.startsWith("text()", i)) {
      steps.push({ axis, preds: [], terminal: "text" });
      i += 6;
      continue;
    }
    const m = /^[A-Za-z][A-Za-z0-9_-]*/.exec(expr.slice(i));
    if (!m) {
      break;
    }
    const name = m[0];
    i += m[0].length;
    const preds: Pred[] = [];
    while (i < expr.length && expr[i] === "[") {
      const start = i + 1;
      let depth = 1;
      let quote: string | null = null;
      let j = start;
      while (j < expr.length && depth) {
        const c = expr[j];
        if (quote !== null) {
          if (c === quote) {
            quote = null;
          }
        } else if (c === "'" || c === '"') {
          quote = c;
        } else if (c === "[") {
          depth++;
        } else if (c === "]") {
          depth--;
        }
        j++;
      }
      preds.push(parsePredExpr(expr.slice(start, j - 1)));
      i = j;
    }
    steps.push({ axis, name, preds });
  }
  return steps;
}

function descendantsOf(el: DomNode): DomNode[] {
  const out: DomNode[] = [];
  const walk = (node: DomNode) => {
    for (const child of node.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(el);
  return out;
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
      return (
        el.tag === pred.tag || descendantsOf(el).some((d) => d.tag === pred.tag)
      );
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

function applyStep(step: XStep, nodes: DomNode[]): DomNode[] {
  const candidates: DomNode[] = [];
  for (const node of nodes) {
    const list = step.axis === "child" ? node.children : descendantsOf(node);
    for (const c of list) {
      if (step.name && c.tag !== step.name) {
        continue;
      }
      candidates.push(c);
    }
  }
  const deduped: DomNode[] = [];
  const seen = new Set<DomNode>();
  for (const c of candidates) {
    if (!seen.has(c)) {
      seen.add(c);
      deduped.push(c);
    }
  }
  const total = deduped.length;
  return deduped.filter((el, index) =>
    step.preds.every((p) => matchesPred(p, el, index, total)),
  );
}

export function xpathText(expr: string, node: DomNode): string[] {
  const steps = parsePath(expr);
  let nodes: DomNode[] = [node];
  for (const step of steps) {
    if (step.terminal === "text") {
      const out: string[] = [];
      for (const n of nodes) {
        out.push(...n.textNodes);
      }
      return out;
    }
    if (step.terminal !== undefined) {
      return nodes.map((n) => n.attrs[step.terminal as string] ?? "");
    }
    nodes = applyStep(step, nodes);
  }
  return [];
}

export function xpathNodes(expr: string, root: DomNode): DomNode[] {
  const steps = parsePath(expr);
  let nodes: DomNode[] = [root];
  for (const step of steps) {
    if (step.terminal) {
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
