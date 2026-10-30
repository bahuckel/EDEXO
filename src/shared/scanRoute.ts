/**
 * The scan route (plan 1.3.3 R-4): the shortest way from where the ship is (the arrival star) through the bodies
 * worth flying to — an open path, straight-line light-seconds between the bodies' places (orbitPositions.ts).
 * Exact for up to {@link EXACT_MAX} stops (every order, by subsets); above that nearest neighbour, then 2-opt.
 */
import { distLs, type Vec3 } from "./orbitPositions.js";

export const EXACT_MAX = 12;

export interface RouteStop<T> {
  item: T;
  pos: Vec3;
}

/** The stops in the order to fly them, and the whole way (ls). */
export function shortestScanRoute<T>(start: Vec3, stops: readonly RouteStop<T>[]): { order: RouteStop<T>[]; totalLs: number } {
  const n = stops.length;
  if (n === 0) return { order: [], totalLs: 0 };
  const d = (a: Vec3, b: Vec3) => distLs(a, b);
  const idx = n <= EXACT_MAX ? exact(start, stops, d) : improved(start, stops, d);
  const order = idx.map((i) => stops[i]!);
  let total = 0;
  let at = start;
  for (const s of order) {
    total += d(at, s.pos);
    at = s.pos;
  }
  return { order, totalLs: total };
}

/** Held-Karp over subsets: the cheapest open path from the start through every stop. */
function exact<T>(start: Vec3, stops: readonly RouteStop<T>[], d: (a: Vec3, b: Vec3) => number): number[] {
  const n = stops.length;
  const full = (1 << n) - 1;
  const cost = new Float64Array((1 << n) * n).fill(Infinity);
  const prev = new Int8Array((1 << n) * n).fill(-1);
  for (let j = 0; j < n; j++) cost[(1 << j) * n + j] = d(start, stops[j]!.pos);
  for (let mask = 1; mask <= full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const c = cost[mask * n + j]!;
      if (c === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const v = c + d(stops[j]!.pos, stops[k]!.pos);
        if (v < cost[next * n + k]!) {
          cost[next * n + k] = v;
          prev[next * n + k] = j;
        }
      }
    }
  }
  let last = 0;
  for (let j = 1; j < n; j++) if (cost[full * n + j]! < cost[full * n + last]!) last = j;
  const out: number[] = [];
  for (let mask = full, j = last; j >= 0; ) {
    out.push(j);
    const p = prev[mask * n + j]!;
    mask &= ~(1 << j);
    j = p;
  }
  return out.reverse();
}

/** Nearest neighbour from the start, then 2-opt (reversing a stretch) while it shortens the path. */
function improved<T>(start: Vec3, stops: readonly RouteStop<T>[], d: (a: Vec3, b: Vec3) => number): number[] {
  const left = new Set(stops.map((_, i) => i));
  const path: number[] = [];
  let at = start;
  while (left.size) {
    let best = -1;
    for (const i of left) if (best < 0 || d(at, stops[i]!.pos) < d(at, stops[best]!.pos)) best = i;
    path.push(best);
    left.delete(best);
    at = stops[best]!.pos;
  }
  const p = (k: number) => (k < 0 ? start : stops[path[k]!]!.pos);
  for (let improvedOnce = true, rounds = 0; improvedOnce && rounds < 50; rounds++) {
    improvedOnce = false;
    for (let i = 0; i < path.length - 1; i++) {
      for (let k = i + 1; k < path.length; k++) {
        // Reverse path[i..k]: the edge into i and the edge out of k change.
        const before = d(p(i - 1), p(i)) + (k + 1 < path.length ? d(p(k), p(k + 1)) : 0);
        const after = d(p(i - 1), p(k)) + (k + 1 < path.length ? d(p(i), p(k + 1)) : 0);
        if (after < before - 1e-9) {
          path.splice(i, k - i + 1, ...path.slice(i, k + 1).reverse());
          improvedOnce = true;
        }
      }
    }
  }
  return path;
}
