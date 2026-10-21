/**
 * Run async work over items with bounded concurrency; results come back in input order.
 *
 * The only copy. There were five — this one returning nothing, and four private ones in
 * `spanshCheckout.ts` (two), `spanshStationBody.ts` and `spanshSystemDebug.ts` that returned
 * results — all the same loop.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}
