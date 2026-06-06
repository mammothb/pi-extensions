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
 * Check whether an error is retryable.
 *
 * Retries on connection errors (ECONNREFUSED, etc.) and HTTP 502/503/504
 * (gateway errors that can occur during container startup). Does NOT retry
 * on abort/timeout, 4xx client errors, or response parsing errors.
 */
function isRetryable(error: unknown): boolean {
  // Don't retry abort/timeout
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  // Connection errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT, etc.)
  if (error instanceof TypeError) {
    return true;
  }
  // HTTP 502 (Bad Gateway), 503 (Service Unavailable), 504 (Gateway Timeout)
  if (error instanceof Error && /HTTP 50[234]/.test(error.message)) {
    return true;
  }
  return false;
}

/**
 * Retry a function with exponential backoff.
 *
 * Uses a time budget (80% of timeoutMs) rather than a fixed retry count.
 * This ensures the total retry period stays within the configured timeout
 * while leaving enough time for the actual search request to complete.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const retryBudget = Math.min(timeoutMs * 0.8, 20_000);
  const baseDelay = 300;
  const startTime = Date.now();

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (signal.aborted || !isRetryable(error)) {
        throw error;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= retryBudget) {
        throw error;
      }

      const delay = Math.min(baseDelay * 2 ** attempt, retryBudget - elapsed);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Create a SearXNG search provider.
 *
 * Calls a SearXNG instance's `/search` endpoint with `format=json`
 * and returns formatted text results.
 *
 * Automatically retries on connection errors and 502/503/504 responses
 * so that searches work even while the Docker container is still starting.
 */
export function createSearxngProvider(config: SearxngConfig): SearchProvider {
  const { url, safesearch, timeoutMs } = config;

  return {
    name: "searxng",

    usageNotes:
      "\n  - Results are fetched from a self-hosted SearXNG metasearch instance",

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

        const text = await withRetry(
          async () => {
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
              return "";
            }

            return results.join("\n\n---\n\n");
          },
          controller.signal,
          timeoutMs,
        );

        return text || undefined;
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
