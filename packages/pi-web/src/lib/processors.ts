import { Parser } from "htmlparser2";
import TurndownService from "turndown";

export function toMarkdown(contentType: string, html: string): string {
  if (!contentType.includes("text/html")) {
    return html;
  }
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndownService.remove(["link", "meta", "script", "style"]);
  return turndownService.turndown(html);
}

export function toText(contentType: string, html: string): string {
  if (!contentType.includes("text/html")) {
    return html;
  }

  const tagsToSkip = [
    "script",
    "style",
    "noscript",
    "iframe",
    "object",
    "embed",
  ];
  let text = "";
  let skipDepth = 0;

  const parser = new Parser({
    onopentag(name, _attribs, _isImplied) {
      if (skipDepth > 0 || tagsToSkip.includes(name)) {
        skipDepth++;
      }
    },
    ontext(data) {
      if (skipDepth === 0) {
        text += data;
      }
    },
    onclosetag(_name, _isImplied) {
      if (skipDepth > 0) {
        skipDepth--;
      }
    },
  });

  parser.write(html);
  parser.end();

  return text.trim();
}
