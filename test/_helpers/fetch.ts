import { vi } from "vitest";

/**
 * Mocks globalThis.fetch with a function that respects AbortSignal.
 * Returns the vitest mock function so tests can assert on (url, init).
 *
 * The mock resolves to the given Response by default, but rejects with
 * an AbortError if the signal passed via `init.signal` fires before
 * the mock settles.
 */
export function mockFetch(opts: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
  /** If true, the returned promise never settles (useful for timeout tests). */
  neverResolves?: boolean;
}): ReturnType<typeof vi.fn> {
  const status = opts.status ?? 200;
  const statusText = opts.statusText ?? "";
  const headers = new Headers(opts.headers ?? {});
  const body = opts.body ?? "";

  const mock = vi
    .fn()
    .mockImplementation((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((resolve, reject) => {
        if (opts.neverResolves) {
          // Promise never settles – for timeout tests
          init?.signal?.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
          return;
        }

        if (init?.signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }

        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });

        resolve(new Response(body, { status, statusText, headers }));
      });
    });

  vi.stubGlobal("fetch", mock);
  return mock;
}
