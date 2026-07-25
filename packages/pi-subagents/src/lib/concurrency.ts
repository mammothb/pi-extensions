/**
 * Process an array of items with bounded concurrency.
 *
 * New workers start as previous ones finish. If any worker rejects or the
 * abort signal fires, in-flight workers are aborted and the rejection
 * propagates. Results are returned in original index order.
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length && !controller.signal.aborted) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) {
        throw new Error(`Unexpected undefined at index ${index}`);
      }
      try {
        results[index] = await fn(item, index, controller.signal);
      } catch (err) {
        firstError = err;
        controller.abort();
        return;
      }
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );

  await Promise.all(workers);

  signal?.removeEventListener("abort", onAbort);

  if (firstError !== null) {
    throw firstError;
  }

  return results;
}
