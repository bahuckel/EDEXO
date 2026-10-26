/**
 * One copy of each repeated text (owner, 2026-10-26: server memory). Every journal line is parsed on its own, so a
 * value such as "phosphorus" or "High metal content body" became a new string on every scan: a heap snapshot after
 * the journal boot held "phosphorus" 18,844 times and 7.8 MB of exact duplicates in all. Values that repeat across
 * bodies (classes, atmospheres, volcanism, material and gas names, scan types) go through here when a scan is stored,
 * and the parsed copy is left for the garbage collector.
 *
 * The pool only grows with distinct values, which for these fields number in the hundreds; it stops adding at
 * {@link MAX_INTERNED} so an unexpected free-text field cannot grow it without bound.
 */
const pool = new Map<string, string>();
export const MAX_INTERNED = 20_000;

export function intern(s: string): string {
  const known = pool.get(s);
  if (known !== undefined) return known;
  if (pool.size < MAX_INTERNED) pool.set(s, s);
  return s;
}

/** `[{ Name, Name_Localised?, Percent }]` as the journal writes Materials and AtmosphereComposition: names interned in place. */
export function internNamedPercents(list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.Name === "string") o.Name = intern(o.Name);
    if (typeof o.Name_Localised === "string") o.Name_Localised = intern(o.Name_Localised);
  }
}

/** For tests. */
export function internPoolSize(): number {
  return pool.size;
}
