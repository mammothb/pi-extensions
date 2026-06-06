import type { SearchArgs, SearchProvider } from "../types";

/**
 * Configuration for the SearXNG provider.
 */
export interface SearxngConfig {
  /** SearXNG instance URL (e.g. "http://localhost:8888"). */
  url: string;
  /** SafeSearch level: 0 (off), 1 (moderate), 2 (strict). */
  safesearch: 0 | 1 | 2;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
}

interface SearxngRawResult {
  title?: string | null;
  url?: string | null;
  content?: string | null;
  engine?: string | null;
}

interface SearxngResponse {
  results: SearxngRawResult[];
}

/**
 * Create a SearXNG search provider.
 *
 * Calls a SearXNG instance's `/search` endpoint with `format=json`
 * and returns formatted text results.
 */
export function createSearxngProvider(config: SearxngConfig): SearchProvider {
  const { url, safesearch, timeoutMs } = config;

  return {
    name: "searxng",

    async search(
      args: SearchArgs,
      signal?: AbortSignal,
    ): Promise<string | undefined> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Forward external signal
      const onAbort = () => controller.abort();
      if (signal) {
        if (signal.aborted) {
          throw new Error("Request aborted");
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      try {
        const searchUrl = new URL("/search", url);
        searchUrl.searchParams.set("q", args.query);
        searchUrl.searchParams.set("format", "json");
        searchUrl.searchParams.set("safesearch", String(safesearch));

        const response = await fetch(searchUrl.toString(), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(
            `SearXNG returned HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as SearxngResponse;
        const results = (data.results ?? [])
          .filter((r): r is typeof r & { url: string } => r.url != null)
          .slice(0, args.numResults)
          .map((r, i) => {
            const title = r.title ?? "Untitled";
            const url = r.url;
            const content = r.content ?? "";
            return `## **${i + 1}.** ${title}\n**URL:** ${url}\n${content}`;
          });

        if (results.length === 0) {
          return undefined;
        }

        return results.join("\n\n---\n\n");
      } catch (error) {
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
