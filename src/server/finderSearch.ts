/**
 * The system finder's search (plan docs/plan-finder-1.2.20.md): systems within `radiusLy` of the nearest reference,
 * every filter a floor, the colonised and claimed left out unless asked for.
 *
 * Cheap filters run first (a few byte compares per system), the distance only for a system that passed them: on a
 * reference grid of the radius's own size, a system looks at the 27 cells round its own. Blocks out of reach of
 * every reference are not read at all. The thread is handed back between blocks, and a time budget ends a search
 * that would run on (the drawer says the list is partial).
 */
import {
  FINDER_COUNT_KEYS,
  FINDER_FLAG,
  FINDER_GAS_GIANTS,
  type FinderCountKey,
  type FinderHit,
  type FinderQuery,
  type FinderResult,
} from "../shared/finder.js";
import type { FinderBlock, FinderIndex } from "./finderIndex.js";

export interface FinderRef {
  name: string;
  x: number;
  y: number;
  z: number;
}

/**
 * A cell's three coordinates as one number (each offset into 0..65535: at the smallest radius, 15 ly, the galaxy
 * spans about ±4,700 cells). A number key, not a string: "all colonised" hashes 132,000 references twice a search.
 */
const cellKey = (a: number, b: number, c: number): number => ((a + 32768) * 65536 + (b + 32768)) * 65536 + (c + 32768);

/** References hashed into cells of the radius, so "the nearest within r" looks at 27 cells. */
export class RefGrid {
  private readonly cells = new Map<number, FinderRef[]>();
  constructor(
    readonly refs: readonly FinderRef[],
    readonly radius: number,
  ) {
    for (const r of refs) {
      const k = cellKey(Math.floor(r.x / radius), Math.floor(r.y / radius), Math.floor(r.z / radius));
      const list = this.cells.get(k);
      if (list) list.push(r);
      else this.cells.set(k, [r]);
    }
  }
  /** The nearest reference within the radius, or null. */
  nearest(x: number, y: number, z: number): { ref: FinderRef; d: number } | null {
    const r = this.radius;
    const cx = Math.floor(x / r);
    const cy = Math.floor(y / r);
    const cz = Math.floor(z / r);
    let best: FinderRef | null = null;
    let bestD2 = r * r;
    for (let a = cx - 1; a <= cx + 1; a++)
      for (let b = cy - 1; b <= cy + 1; b++)
        for (let c = cz - 1; c <= cz + 1; c++) {
          const list = this.cells.get(cellKey(a, b, c));
          if (!list) continue;
          for (const p of list) {
            const dx = p.x - x;
            const dy = p.y - y;
            const dz = p.z - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= bestD2) {
              bestD2 = d2;
              best = p;
            }
          }
        }
    return best ? { ref: best, d: Math.sqrt(bestD2) } : null;
  }
}

export interface FinderSearchOptions {
  /** Systems the commander knows are colonised or claimed (own colonies, depots seen), by id64 or name. */
  knownClaimed?: { ids: Set<string>; names: Set<string> };
  /**
   * The references are every colonised system: read each system's stored distance to the nearest one instead of
   * measuring (with 130,000 references the measuring was the search; 2,000,000 systems in range at 150 ly). The
   * grid is then asked only for the listed hits, to name their reference.
   */
  precomputedColonised?: boolean;
  /** Wall-clock budget; the list found so far is returned with `partial`. */
  budgetMs?: number;
  /** Hand the thread back between blocks (tests pass a no-op). */
  yieldEvery?: () => Promise<void>;
  now?: () => number;
}

const defaultYield = () => new Promise<void>((r) => setImmediate(r));

/** Every colonised system in the file, for the "all colonised" reference (read once per file: all blocks). */
export async function colonisedRefs(index: FinderIndex, yieldEvery = defaultYield): Promise<FinderRef[]> {
  const out: FinderRef[] = [];
  for await (const [i, b] of index.inOrder(index.allBlocks())) {
    const flags = b.u8.flags!;
    let names: string[] | null = null;
    for (let j = 0; j < b.n; j++) {
      if (flags[j]! & FINDER_FLAG.colonised) {
        names ??= b.names();
        out.push({ name: names[j] ?? "", x: b.x[j]!, y: b.y[j]!, z: b.z[j]! });
      }
    }
    if (i % 64 === 63) await yieldEvery();
  }
  return out;
}

/** Look a system up by name in the file (a picked system that is not in the galaxy index). */
export async function findInFinder(
  index: FinderIndex,
  name: string,
  yieldEvery = defaultYield,
): Promise<FinderRef | null> {
  const want = name.trim().toLowerCase();
  for await (const [i, b] of index.inOrder(index.allBlocks())) {
    const names = b.names();
    for (let j = 0; j < b.n; j++) {
      const n = names[j]!;
      if (n.length === want.length && n.toLowerCase() === want) return { name: n, x: b.x[j]!, y: b.y[j]!, z: b.z[j]! };
    }
    if (i % 64 === 63) await yieldEvery();
  }
  return null;
}

/** Each filter as (column, floor) pairs, the derived ones as sums. */
function compileMins(q: FinderQuery, block: FinderBlock) {
  const singles: [Uint8Array, number][] = [];
  let ggFloor = 0;
  let bodiesFloor = 0;
  for (const [k, v] of Object.entries(q.min)) {
    if (!v) continue;
    if (k === "gg_any") ggFloor = v;
    else if (k === "bodies") bodiesFloor = v;
    else {
      const col = block.u8[k];
      if (col) singles.push([col, v]);
    }
  }
  const gg = ggFloor ? FINDER_GAS_GIANTS.map((k) => block.u8[k]!).filter(Boolean) : [];
  return { singles, ggFloor, gg, bodiesFloor };
}

export async function searchFinder(
  index: FinderIndex,
  q: FinderQuery,
  refs: readonly FinderRef[],
  opts: FinderSearchOptions = {},
): Promise<FinderResult> {
  const now = opts.now ?? (() => performance.now());
  const started = now();
  const budget = opts.budgetMs ?? 8000;
  const yieldEvery = opts.yieldEvery ?? defaultYield;
  const base = {
    // At most 2,000 back to the map ("all colonised" is 132,000: megabytes per search for dots nobody can count),
    // every n-th so they spread over the galaxy (the file's order is block by block: the first 2,000 were one corner).
    references: everyNth(refs, 2000).map((r) => ({ name: r.name, x: r.x, y: r.y, z: r.z })),
    dump: index.meta.dump ?? null,
    builtAt: index.meta.builtAt ?? null,
  };
  if (!refs.length) return { hits: [], matched: 0, partial: false, problem: "no reference systems", ...base };

  const r = q.radiusLy;
  const grid = new RefGrid(refs, r);
  const starIdx = (k: string) => index.meta.starClasses.indexOf(k);
  const mainSet = new Set(q.mainStar.map(starIdx).filter((i) => i >= 0));
  let presentMask = 0;
  for (const k of q.starsPresent) {
    const i = starIdx(k);
    if (i >= 0) presentMask |= 1 << i;
  }
  const hideMask = FINDER_FLAG.populated | FINDER_FLAG.colonised | FINDER_FLAG.claimed;

  // Blocks within reach of some reference: each reference against each block's box for a handful of references;
  // for many ("all colonised", 132,000) a grid lookup from the block's centre with the box's half-diagonal added.
  const r2 = r * r;
  const todo: number[] = [];
  if (refs.length <= 256) {
    for (let i = 0; i < index.blocks.length; i++) {
      const b = index.blocks[i]!;
      for (const p of refs)
        if (index.blockDist2(b, p.x, p.y, p.z) <= r2) {
          todo.push(i);
          break;
        }
    }
  } else {
    const half = index.meta.blockLy / 2;
    const reach = new RefGrid(refs, r + half * Math.sqrt(3));
    for (let i = 0; i < index.blocks.length; i++) {
      const m = index.blockMin(index.blocks[i]!);
      if (reach.nearest(m.x + half, m.y + half, m.z + half)) todo.push(i);
    }
  }

  // A candidate is a block number and a row, not the block: holding blocks here would keep hundreds of them past the
  // index's cache. The few blocks the final list needs are read again at the end (usually still cached).
  type Cand = { bi: number; j: number; d: number; listed: number; ref: FinderRef | null };
  const rCenti = Math.round(r * 100);
  const cands: Cand[] = [];
  // Once the list has been trimmed full, its last entry is the bar: a system that does not sort before it is counted
  // and dropped on the spot (5.6 million matches at 150 ly round every colony were otherwise ~4,000 sorts).
  let bar: Cand | null = null;
  const byBodies = q.sort === "bodies";
  const beatsBar = (d: number, listed: number) =>
    !bar || (byBodies ? listed > bar.listed || (listed === bar.listed && d < bar.d) : d < bar.d);
  let matched = 0;
  let partial = false;
  for await (const [bi, b] of index.inOrder(todo)) {
    if (now() - started > budget) {
      partial = true;
      break;
    }
    const flags = b.u8.flags!;
    const main = b.u8.mainStar!;
    const { singles, ggFloor, gg, bodiesFloor } = compileMins(q, b);
    let names: string[] | null = null;
    outer: for (let j = 0; j < b.n; j++) {
      const f = flags[j]!;
      if (q.hideClaimed && f & hideMask) continue;
      if (q.fullyScanned && !(f & FINDER_FLAG.fullyScanned)) continue;
      if (bodiesFloor && b.listed[j]! < bodiesFloor) continue;
      for (const [col, v] of singles) if (col[j]! < v) continue outer;
      if (ggFloor) {
        let s = 0;
        for (const c of gg) s += c[j]!;
        if (s < ggFloor) continue;
      }
      if (mainSet.size && !mainSet.has(main[j]!)) continue;
      if (presentMask && !(b.starMask[j]! & presentMask)) continue;
      let near: { ref: FinderRef | null; d: number } | null;
      if (opts.precomputedColonised) {
        const dc = b.distColonised[j]!;
        // 0: a second catalogue entry at a colonised system's own position ("7 Camelopardalis C"), not a system to take.
        near = dc > 0 && dc <= rCenti ? { ref: null, d: dc / 100 } : null;
      } else near = grid.nearest(b.x[j]!, b.y[j]!, b.z[j]!);
      if (!near) continue;
      if (q.hideClaimed && opts.knownClaimed) {
        names ??= b.names();
        if (opts.knownClaimed.ids.has(String(b.id64[j])) || opts.knownClaimed.names.has(names[j]!.toLowerCase()))
          continue;
      }
      matched++;
      const listed = b.listed[j]!;
      if (beatsBar(near.d, listed)) cands.push({ bi, j, d: near.d, listed, ref: near.ref });
    }
    // Keep the candidate list bounded: trim to the best `limit` now and then.
    if (cands.length > q.limit * 8) {
      trim(cands, q);
      bar = cands.length === q.limit ? cands[q.limit - 1]! : null;
    }
    await yieldEvery();
  }
  trim(cands, q);
  const hits: FinderHit[] = [];
  for (const c of cands) {
    const b = await index.block(c.bi);
    // A stored distance: name the reference now, for the few systems listed.
    const ref = c.ref ?? grid.nearest(b.x[c.j]!, b.y[c.j]!, b.z[c.j]!)?.ref ?? { name: "", x: 0, y: 0, z: 0 };
    hits.push(hitOf(index, b, c.j, c.d, ref));
  }
  return { hits, matched, partial, problem: null, ...base };
}

/** At most `max` of `list`, evenly spaced through it. */
function everyNth<T>(list: readonly T[], max: number): T[] {
  if (list.length <= max) return list.slice();
  const step = list.length / max;
  return Array.from({ length: max }, (_, i) => list[Math.floor(i * step)]!);
}

function trim(cands: { d: number; listed: number }[], q: FinderQuery): void {
  cands.sort(q.sort === "bodies" ? (a, b) => b.listed - a.listed || a.d - b.d : (a, b) => a.d - b.d);
  cands.length = Math.min(cands.length, q.limit);
}

function hitOf(index: FinderIndex, b: FinderBlock, j: number, d: number, ref: FinderRef): FinderHit {
  const counts = {} as Record<FinderCountKey, number>;
  for (const k of FINDER_COUNT_KEYS) counts[k] = b.u8[k]?.[j] ?? 0;
  const cls = index.meta.starClasses;
  const mask = b.starMask[j]!;
  const f = b.u8.flags![j]!;
  const bc = b.bodyCount[j]!;
  const m = b.u8.mainStar![j]!;
  return {
    id64: String(b.id64[j]),
    name: b.names()[j] ?? "",
    x: b.x[j]!,
    y: b.y[j]!,
    z: b.z[j]!,
    distLy: Math.round(d * 100) / 100,
    reference: ref.name,
    mainStar: m === 255 ? null : (cls[m] ?? null),
    starsPresent: cls.filter((_, i) => mask & (1 << i)),
    counts,
    listed: b.listed[j]!,
    bodyCount: bc === 0xffff ? null : bc,
    fullyScanned: (f & FINDER_FLAG.fullyScanned) !== 0,
    colonised: (f & FINDER_FLAG.colonised) !== 0,
    claimed: (f & FINDER_FLAG.claimed) !== 0,
  };
}
