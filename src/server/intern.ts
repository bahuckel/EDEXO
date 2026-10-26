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

/*
  `Parents` entries ({ Star: 0 }, { Planet: 3 }, { Null: 1 }): 119,358 in the owner's journals, 318 distinct. Each
  entry is replaced by one shared object per (kind, id); the arrays stay the body's own.
*/
const parentsPool = new Map<string, object>();

export function internParents(list: unknown): void {
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const e: unknown = list[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const keys = Object.keys(e);
    if (keys.length !== 1) continue;
    const v = (e as Record<string, unknown>)[keys[0]!];
    if (typeof v !== "number") continue;
    const id = `${keys[0]}:${v}`;
    const known = parentsPool.get(id);
    if (known) list[i] = known;
    else if (parentsPool.size < MAX_INTERNED) parentsPool.set(id, e);
  }
}

type NamedPercents = { Name?: string; Percent?: number }[] | undefined;
const samePairs = (a: NamedPercents, b: unknown): boolean => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i] as { Name?: string; Percent?: number } | null;
    if (!y || x.Name !== y.Name || x.Percent !== y.Percent) return false;
  }
  return true;
};

/**
 * After a load from the journal cache: a body's scan copy shares the materials and gas lists of its scan record again.
 * Read from the journals the two hold the same arrays; the cache writes them separately, so a cached start held every
 * list twice (420,326 material entries for 221,903 in the journals, owner's profile, 2026-10-26). Equal lists only.
 */
export function shareScanLists(
  bodies: Iterable<[string, { scan?: { materials?: NamedPercents; atmosphereComposition?: NamedPercents } | null }]>,
  recordOf: (key: string) => { materials?: unknown; atmosphereComposition?: unknown } | undefined,
): number {
  let shared = 0;
  for (const [key, body] of bodies) {
    const scan = body.scan;
    if (!scan) continue;
    const rec = recordOf(key);
    if (!rec) continue;
    if (scan.materials && scan.materials !== rec.materials && samePairs(scan.materials, rec.materials)) {
      scan.materials = rec.materials as NamedPercents;
      shared++;
    }
    if (
      scan.atmosphereComposition &&
      scan.atmosphereComposition !== rec.atmosphereComposition &&
      samePairs(scan.atmosphereComposition, rec.atmosphereComposition)
    ) {
      scan.atmosphereComposition = rec.atmosphereComposition as NamedPercents;
      shared++;
    }
  }
  return shared;
}

/** For tests. */
export function internPoolSize(): number {
  return pool.size;
}
