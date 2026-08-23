/**
 * Shared result formatting for all search providers.
 *
 * Providers return structured results; the tool layer appends the trailer so
 * the payload grammar is identical regardless of provider.
 */

export interface FormattableResult {
  title: string;
  href: string;
  body: string;
}

/** Appended by the WebSearch tool to every successful provider result. */
export const SNIPPET_TRAILER =
  "\n\n---\n\nIMPORTANT: These are only short snippets. " +
  'To get the full page content, call WebFetch with the url parameter (e.g. {"url": "<URL>"}).';

export function formatSearchResults(results: FormattableResult[]): string {
  const parts = results.map((result) => {
    const title = result.title.replace(/\s+/g, " ");
    const href = result.href.trim();
    const snippet = result.body.replace(/\s+/g, " ");
    return `Title: ${title}\nURL: ${href}\nSnippet: ${snippet}`;
  });
  return parts.join("\n\n---\n\n");
}
