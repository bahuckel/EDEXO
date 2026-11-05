/**
 * The shortest order to fly a boxel's systems (owner, 2026-11-04: "go from g20 > g121 > g96 > g67 and so on from the
 * same boxel, as the routes are shortest that way, instead of going numerically up"). Positions come from routes he
 * plotted in the galaxy map (NavRoute.json gives every system's StarPos, the destination too) and from Spansh's
 * look-up of the boxel; a target alone gives none (FSDTarget and Status.json carry a name and an address only).
 *
 * Nearest neighbour from where he is, then 2-opt on the open path (the start stays fixed): on his Eembaids EG-Y boxel,
 * g0 to g21 by number is 7,575 ly, this order 3,904. Systems with no position follow by number, after the placed ones.
 */
export type Vec3 = readonly [number, number, number];

export interface BoxelOrder {
  /** Every system still to fly: the placed ones in the shortest order, then the rest by number. */
  order: number[];
  /** Light years from the one before (from where he is, for the first); null for a system with no position. */
  legs: (number | null)[];
  /** How many of `order` have a position. */
  placed: number;
  /** The placed ones flown in this order, light years (from where he is when known). */
  orderLy: number;
  /** The same systems flown by number, light years, for comparison. */
  numericLy: number;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Light years along `path` (numbers into `pos`), from `start` when given. */
function pathLy(path: readonly number[], pos: ReadonlyMap<number, Vec3>, start: Vec3 | null): number {
  let ly = 0;
  let at = start;
  for (const n of path) {
    const p = pos.get(n)!;
    if (at) ly += dist(at, p);
    at = p;
  }
  return ly;
}

/** 2-opt passes at most. */
const MAX_PASSES = 40;
/**
 * Each system's nearest few are the only new neighbours a 2-opt move tries (a long new edge never shortens the path):
 * a pass is O(n·K) instead of O(n²), so a g boxel's 2,000 systems take tens of milliseconds, not two seconds.
 */
const K = 12;

/** The K nearest of each placed system, by index into `pts`. */
function nearestOf(pts: readonly Vec3[]): number[][] {
  return pts.map((a, i) => {
    const best: { j: number; d: number }[] = [];
    for (let j = 0; j < pts.length; j++) {
      if (j === i) continue;
      const d = dist(a, pts[j]!);
      if (best.length < K) best.push({ j, d });
      else if (d < best[K - 1]!.d) best[K - 1] = { j, d };
      else continue;
      best.sort((x, y) => x.d - y.d);
    }
    return best.map((b) => b.j);
  });
}

/**
 * 2-opt on the open path, in place: reverse path[i..j] when the new edge (before i → path[j]) and the one after it
 * shorten the path. Before position 0 is `start` (none: the first system stays first). The new edge's far end is one of
 * the near end's nearest few.
 */
function twoOpt(path: number[], pos: ReadonlyMap<number, Vec3>, start: Vec3 | null): void {
  const pts = path.map((n) => pos.get(n)!);
  const near = nearestOf(start ? [...pts, start] : pts);
  const S = pts.length; // `start`'s index in `near`
  let at = path.map((_n, k) => k); // position k holds point at[k]
  const where = at.slice(); // point → its position
  const pt = (k: number): Vec3 => (k < 0 ? start! : pts[at[k]!]!);
  for (let pass = 0, better = true; better && pass < MAX_PASSES; pass++) {
    better = false;
    const flip = (i: number, j: number) => {
      at = [...at.slice(0, i), ...at.slice(i, j + 1).reverse(), ...at.slice(j + 1)];
      for (let k = i; k <= j; k++) where[at[k]!] = k;
      better = true;
    };
    const first = start ? 0 : 1;
    for (let i = first; i < at.length; i++) {
      const a = pt(i - 1);
      const b = pt(i);
      const ab = dist(a, b);
      let moved = false;
      // A new edge from a (the one before i) to a near c further on: reverse i..c.
      for (const c of near[i === 0 ? S : at[i - 1]!]!) {
        if (c === S) continue;
        const j = where[c]!;
        if (j <= i) continue;
        const ac = dist(a, pts[c]!);
        if (ac >= ab) break; // the rest are further still
        const d = j + 1 < at.length ? pt(j + 1) : null;
        if (ab + (d ? dist(pts[c]!, d) : 0) - ac - (d ? dist(b, d) : 0) > 1e-9) {
          flip(i, j);
          moved = true;
          break;
        }
      }
      if (moved) continue;
      // A new edge from b to a near e further back: reverse e..i-1 (e stays after the point before it).
      for (const e of near[at[i]!]!) {
        if (e === S) continue;
        const j = where[e]!;
        if (j >= i - 1 || j < first) continue;
        const be = dist(b, pts[e]!);
        if (be >= ab) break;
        const c = pt(j - 1);
        if (ab + dist(c, pts[e]!) - be - dist(c, a) > 1e-9) {
          flip(j, i - 1);
          break;
        }
      }
    }
  }
  const out = at.map((k) => path[k]!);
  path.splice(0, path.length, ...out);
}

/**
 * The last few answers: the Boxels screen and the run ask for the same order after every refresh, and a position only
 * ever joins (a plotted route, a look-up), so the systems left, how many are placed and where he is say it all.
 */
const memo = new Map<string, BoxelOrder>();

export function shortestBoxelOrder(todo: readonly number[], pos: ReadonlyMap<number, Vec3>, start: Vec3 | null): BoxelOrder {
  // Each placed system's position is in the key: two boxels with the same numbers left are not one order (review
  // 2026-11-05: the second got the first's).
  const where = todo.map((n) => {
    const p = pos.get(n);
    return p ? `${n}@${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)}` : String(n);
  });
  const key = `${where.join(";")}|${start ? start.map((v) => v.toFixed(2)).join(",") : "-"}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const o = computeOrder(todo, pos, start);
  memo.set(key, o);
  if (memo.size > 8) memo.delete(memo.keys().next().value!);
  return o;
}

function computeOrder(todo: readonly number[], pos: ReadonlyMap<number, Vec3>, start: Vec3 | null): BoxelOrder {
  const byNumber = [...todo].sort((a, b) => a - b);
  const placed = byNumber.filter((n) => pos.has(n));
  const unplaced = byNumber.filter((n) => !pos.has(n));
  // Nearest neighbour: from where he is, else from the lowest placed system.
  const path: number[] = [];
  const left = new Set(placed);
  let at = start;
  if (!at && placed.length) {
    path.push(placed[0]!);
    left.delete(placed[0]!);
    at = pos.get(placed[0]!)!;
  }
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const n of left) {
      const d = dist(at!, pos.get(n)!);
      if (d < bestD || (d === bestD && n < best)) [best, bestD] = [n, d];
    }
    path.push(best);
    left.delete(best);
    at = pos.get(best)!;
  }
  twoOpt(path, pos, start);
  // A heuristic: on a few small layouts by number is shorter (review 2026-11-05, 8 of 3,000): then it is that.
  if (pathLy(path, pos, start) > pathLy(placed, pos, start)) path.splice(0, path.length, ...placed);
  const legs: (number | null)[] = [];
  let prev = start;
  for (const n of path) {
    const q = pos.get(n)!;
    legs.push(prev ? Math.round(dist(prev, q)) : null);
    prev = q;
  }
  return {
    order: [...path, ...unplaced],
    legs: [...legs, ...unplaced.map(() => null)],
    placed: path.length,
    orderLy: Math.round(pathLy(path, pos, start)),
    numericLy: Math.round(pathLy(placed, pos, start)),
  };
}
