import type { MaterialBuyStationHit } from "./materialBuyIndexTypes";
import { constructionHopLy, lookupGalaxyDistanceLy, lyOrLast } from "./systemDistanceLy";
import { normSystemName } from "./stationFilter";

type HeapEntry = { distanceLy: number; systemNorm: string };

/** Binary min-heap — Dijkstra frontier ordered by Ly from construction origin. */
class MinHeap {
  private data: HeapEntry[] = [];

  push(distanceLy: number, systemNorm: string): void {
    this.data.push({ distanceLy, systemNorm });
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapEntry | null {
    if (!this.data.length) return null;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p]!.distanceLy <= this.data[i]!.distanceLy) break;
      [this.data[p], this.data[i]] = [this.data[i]!, this.data[p]!];
      i = p;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && this.data[l]!.distanceLy < this.data[smallest]!.distanceLy) smallest = l;
      if (r < n && this.data[r]!.distanceLy < this.data[smallest]!.distanceLy) smallest = r;
      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest]!, this.data[i]!];
      i = smallest;
    }
  }
}

function hitDistanceLy(
  hit: MaterialBuyStationHit,
  originSystem: string,
  distanceBySystem: Record<string, number>,
): number {
  /** A cost for the graph: unknown is "unreachable", never a number someone could read as a distance. */
  return lyOrLast(constructionHopLy(originSystem, hit.systemName, hit.distanceLy, distanceBySystem));
}

function minSystemDistance(
  systemNorm: string,
  hits: MaterialBuyStationHit[],
  originSystem: string,
  distanceBySystem: Record<string, number>,
): number {
  const originNorm = normSystemName(originSystem);
  if (systemNorm === originNorm) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const hit of hits) {
    if (normSystemName(hit.systemName) !== systemNorm) continue;
    best = Math.min(best, hitDistanceLy(hit, originSystem, distanceBySystem));
  }
  const sample = hits.find((h) => normSystemName(h.systemName) === systemNorm);
  if (sample) {
    const mapped = lookupGalaxyDistanceLy(
      sample.systemName,
      distanceBySystem,
      normSystemName,
      originSystem,
    );
    if (mapped != null) best = Math.min(best, mapped);
  }
  return best;
}

/**
 * Dijkstra from construction origin across seller systems (star edges: origin → system at best known Ly).
 * Returns normalized system name → shortest Ly from origin.
 */
function dijkstraReachFromOrigin(
  originSystem: string,
  hits: MaterialBuyStationHit[],
  distanceBySystem: Record<string, number> = {},
): Map<string, number> {
  const originNorm = normSystemName(originSystem);
  const out = new Map<string, number>();
  if (!originNorm) return out;

  const systems = new Set<string>();
  for (const hit of hits) {
    const sys = normSystemName(hit.systemName);
    if (sys) systems.add(sys);
  }

  const heap = new MinHeap();
  heap.push(0, originNorm);
  out.set(originNorm, 0);

  while (heap.size > 0) {
    const cur = heap.pop();
    if (!cur) break;
    const { distanceLy: curDist, systemNorm } = cur;
    const known = out.get(systemNorm);
    if (known != null && curDist > known) continue;

    for (const tgt of systems) {
      if (tgt === systemNorm) continue;
      const edge =
        systemNorm === originNorm
          ? minSystemDistance(tgt, hits, originSystem, distanceBySystem)
          : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(edge)) continue;
      const next = curDist + edge;
      const prev = out.get(tgt);
      if (prev != null && next >= prev) continue;
      out.set(tgt, next);
      heap.push(next, tgt);
    }
  }

  return out;
}

/** Sort seller hits nearest-first using Dijkstra reach from construction origin. */
export function orderHitsByDijkstraReach(
  originSystem: string,
  hits: MaterialBuyStationHit[],
  distanceBySystem: Record<string, number> = {},
): MaterialBuyStationHit[] {
  if (hits.length <= 1) return [...hits];
  const reach = dijkstraReachFromOrigin(originSystem, hits, distanceBySystem);
  const originNorm = normSystemName(originSystem);
  return [...hits].sort((a, b) => {
    const sysA = normSystemName(a.systemName);
    const sysB = normSystemName(b.systemName);
    const da =
      reach.get(sysA) ??
      (sysA === originNorm ? 0 : hitDistanceLy(a, originSystem, distanceBySystem));
    const db =
      reach.get(sysB) ??
      (sysB === originNorm ? 0 : hitDistanceLy(b, originSystem, distanceBySystem));
    if (da !== db) return da - db;
    if (a.dataSource === "journal" && b.dataSource !== "journal") return -1;
    if (b.dataSource === "journal" && a.dataSource !== "journal") return 1;
    return a.stationName.localeCompare(b.stationName);
  });
}

/**
 * Walk systems in Dijkstra order; assign each commodity to the nearest station that sells it.
 * Local index / journal hits are preferred when distances tie.
 */
export function assignNearestStationPerCommodity(args: {
  originSystem: string;
  needs: Array<{ id: string; label: string }>;
  hitsByCommodity: Map<string, MaterialBuyStationHit[]>;
  distanceBySystem?: Record<string, number>;
}): Map<string, MaterialBuyStationHit> {
  const distanceBySystem = args.distanceBySystem ?? {};
  const out = new Map<string, MaterialBuyStationHit>();
  const remaining = new Set(args.needs.map((n) => n.id).filter(Boolean));
  if (!remaining.size) return out;

  const allHits: MaterialBuyStationHit[] = [];
  for (const hits of args.hitsByCommodity.values()) allHits.push(...hits);
  const reach = dijkstraReachFromOrigin(args.originSystem, allHits, distanceBySystem);
  const systems = [...reach.entries()]
    .filter(([sys]) => sys !== normSystemName(args.originSystem))
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

  for (const [systemNorm] of systems) {
    if (!remaining.size) break;
    for (const needId of [...remaining]) {
      const hits = args.hitsByCommodity.get(needId) ?? [];
      let best: MaterialBuyStationHit | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const hit of hits) {
        if (normSystemName(hit.systemName) !== systemNorm) continue;
        const d = reach.get(systemNorm) ?? hitDistanceLy(hit, args.originSystem, distanceBySystem);
        if (d < bestDist) {
          bestDist = d;
          best = hit;
        }
      }
      if (best) {
        out.set(needId, best);
        remaining.delete(needId);
      }
    }
  }

  for (const needId of remaining) {
    const hits = args.hitsByCommodity.get(needId) ?? [];
    const sorted = orderHitsByDijkstraReach(args.originSystem, hits, distanceBySystem);
    const first = sorted[0];
    if (first) out.set(needId, first);
  }

  return out;
}
