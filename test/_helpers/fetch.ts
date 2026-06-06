import { vi } from "vitest";

/**
 * Mocks globalThis.fetch for a single call.
 * Returns the vitest mock function so tests can assert on (url, init).
 */
export function mockFetchOnce(opts: {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}): ReturnType<typeof vi.fn> {
  const status = opts.status ?? 200;
  const headers = new Headers(opts.headers ?? {});
  const body = opts.body ?? "";
  // Re-wrap any Uint8Array into a fresh `Uint8Array<ArrayBuffer>` so it lines
  // up with `BodyInit`. With recent @types/node + lib.dom, the default
  // `Uint8Array` type widens to `Uint8Array<ArrayBufferLike>` (allowing
  // SharedArrayBuffer), which `BodyInit` rejects. The copy is cheap and
  // semantically identical for these tests.
  const responseBody: BodyInit =
    typeof body === "string" ? body : new Uint8Array(body);

  const mock = vi
    .fn()
    .mockResolvedValue(new Response(responseBody, { status, headers }));

  vi.stubGlobal("fetch", mock);
  return mock;
}
