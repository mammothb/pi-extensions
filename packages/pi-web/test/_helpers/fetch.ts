import { vi } from "vitest";

/**
 * Mocks globalThis.fetch with a function that respects AbortSignal.
 * Returns the vitest mock function so tests can assert on (url, init).
 *
 * The mock resolves to the given Response by default, but rejects with
 * an AbortError if the signal passed via `init.signal` fires before
 * the mock settles.
 *
 * When `body` is a Uint8Array, it is re-wrapped into a fresh
 * `Uint8Array<ArrayBuffer>` for BodyInit compatibility with recent
 * @types/node + lib.dom types.
 */
export function mockFetch(opts: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** If true, the returned promise never settles (useful for timeout tests). */
  neverResolves?: boolean;
}): ReturnType<typeof vi.fn> {
  const status = opts.status ?? 200;
  const statusText = opts.statusText ?? "";
  const headers = new Headers(opts.headers ?? {});
  const rawBody = opts.body ?? "";

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

        // Re-wrap Uint8Array for BodyInit compatibility
        const responseBody: BodyInit =
          typeof rawBody === "string" ? rawBody : new Uint8Array(rawBody);

        resolve(new Response(responseBody, { status, statusText, headers }));
      });
    });

  vi.stubGlobal("fetch", mock);
  return mock;
}

/**
 * Mocks globalThis.fetch for a single call (no AbortSignal support needed).
 * Convenience alias for {@link mockFetch}. Does not support neverResolves.
 */
export function mockFetchOnce(opts: {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}): ReturnType<typeof vi.fn> {
  return mockFetch({ ...opts, statusText: "" });
}
