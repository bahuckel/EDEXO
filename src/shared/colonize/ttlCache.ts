/**
 * A size-capped map with optional expiry — the one copy of what nine caches each wrote by hand
 * (`while (map.size > MAX) map.delete(map.keys().next().value)`, plus an `at` timestamp and an
 * age check at every read site).
 *
 * - Eviction drops the oldest entry. Writing a key makes it the newest; with `touchOnGet`, so does
 *   reading it (true LRU — the coordinate cache wants that, the rest are fine with oldest-written).
 * - Expired entries read as absent and are dropped when read.
 * - `null` is a value like any other, so "we asked and there was nothing" can be cached apart from
 *   "never asked". `undefined` is not: it is what `get` returns for a miss.
 */
export type TtlCacheOptions = {
  /** Entries kept; the oldest goes first. */
  max: number;
  /** Age at which an entry stops being served. Omit for no expiry. */
  ttlMs?: number;
  /** Reading an entry makes it the newest, so the cap evicts the least recently used. */
  touchOnGet?: boolean;
  now?: () => number;
};

type Entry<V> = { value: V; at: number };

export class TtlCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly max: number;
  private readonly ttlMs: number | null;
  private readonly touchOnGet: boolean;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions) {
    this.max = Math.max(1, Math.floor(opts.max));
    this.ttlMs = opts.ttlMs != null && opts.ttlMs > 0 ? opts.ttlMs : null;
    this.touchOnGet = opts.touchOnGet === true;
    this.now = opts.now ?? Date.now;
  }

  /** The value when present and fresh; `undefined` otherwise. */
  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.ttlMs != null && this.now() - e.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    if (this.touchOnGet) {
      this.map.delete(key);
      this.map.set(key, e);
    }
    return e.value;
  }

  /** The value regardless of age — for a caller to whom a stale answer beats none. */
  getStale(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Oldest first, ignoring expiry — for writing the cache to disk. */
  *entries(): IterableIterator<[K, V]> {
    for (const [k, e] of this.map) yield [k, e.value];
  }
}
