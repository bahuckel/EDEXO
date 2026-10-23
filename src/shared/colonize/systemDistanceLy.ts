import { normSystemName } from "./stationFilter";
import { storageGet, storageSet, storageRemove } from "./storage";

/** 3D straight-line distance in ly (Elite galaxy coords). */
export function distanceLy3d(a: [number, number, number], b: [number, number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.hypot(dx, dy, dz);
}

/**
 * S-7. A distance in light years, or `null` when nobody has measured it.
 *
 * "Unknown" used to be four things: `null`, `0`, `Infinity` and `999999`, and two predicates
 * disagreed about `0` — `isKnownConstructionDistanceLy` read it as unknown, `isDisplayableHopLy`
 * as "same system". A seller in the construction system itself (0 Ly, the nearest there is) was
 * therefore sorted last and dropped by a distance limit wherever the first predicate was used; the
 * owner's buy index holds 747 such rows. And `Infinity` does not survive JSON: the index file
 * already held 413 `null`s in a field typed `number`, where `null < 15` is `true`.
 *
 * The rule now: `null` is unknown, `0` is the same system, and nothing else stands in for either.
 * `Infinity` exists only inside comparators, via `lyOrLast`.
 */
export type Ly = number | null;

/** Distance values at or above this are treated as unknown placeholders. */
const DISTANCE_PLACEHOLDER_LY = 50_000;

/** IPC-safe pair separator (never use NUL — Electron IPC can strip it from object keys). */
const GALAXY_DISTANCE_PAIR_SEP = "::";

const GALAXY_DIST_CACHE_KEY = "edexo-colonize-galaxy-dist-v2";

/** A measured distance: finite, not negative, not a placeholder. `0` is known — same system. */
export function isKnownLy(dist: unknown): dist is number {
  return typeof dist === "number" && Number.isFinite(dist) && dist >= 0 && dist < DISTANCE_PLACEHOLDER_LY;
}

/** Normalise anything (JSON `null`, `Infinity`, a placeholder, `undefined`) at a boundary. */
export function toLy(dist: unknown): Ly {
  return isKnownLy(dist) ? dist : null;
}

/** For sorting and minimums only: an unknown distance sorts after every known one. Never store it. */
export function lyOrLast(dist: unknown): number {
  return isKnownLy(dist) ? dist : Number.POSITIVE_INFINITY;
}

/**
 * Sort order for distances: nearer first, unknown after every known one, two unknowns equal.
 *
 * Prefer this to `lyOrLast(a) - lyOrLast(b)`, and above all to a "best so far" that starts at
 * Infinity: `Infinity < Infinity` is false, so such a loop never picks an unknown-distance
 * seller even when it is the only one there is.
 */
export function compareLy(a: unknown, b: unknown): number {
  const ka = isKnownLy(a);
  const kb = isKnownLy(b);
  if (ka && kb) return a - b;
  if (ka) return -1;
  if (kb) return 1;
  return 0;
}

/** The nearer of two distances; unknown only when both are. */
export function nearerLy(a: Ly | undefined, b: Ly | undefined): Ly {
  const ka = isKnownLy(a);
  const kb = isKnownLy(b);
  if (ka && kb) return Math.min(a, b);
  if (ka) return a;
  if (kb) return b;
  return null;
}

/** Pair key: construction ref → seller system (Milky Way Ly). */
export function galaxyDistancePairKey(fromSystem: string, toSystem: string): string {
  return `${normSystemName(fromSystem)}${GALAXY_DISTANCE_PAIR_SEP}${normSystemName(toSystem)}`;
}

function parseGalaxyDistancePairKey(key: string): { from: string; to: string } | null {
  const i = key.indexOf(GALAXY_DISTANCE_PAIR_SEP);
  if (i < 0) return null;
  const from = key.slice(0, i);
  const to = key.slice(i + GALAXY_DISTANCE_PAIR_SEP.length);
  if (!from || !to) return null;
  return { from, to };
}

/** True when map entry is a construction→seller pair (not a legacy flat seller key). */
function isGalaxyDistancePairKey(key: string): boolean {
  return key.includes(GALAXY_DISTANCE_PAIR_SEP);
}

function legacyGalaxyDistancePairKey(fromSystem: string, toSystem: string): string {
  return `${normSystemName(fromSystem)}\0${normSystemName(toSystem)}`;
}

/** Keep pair-key Ly only; migrate legacy NUL-separated keys to `::`. */
export function sanitizeGalaxyDistanceMap(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, d] of Object.entries(map)) {
    if (!isKnownLy(d)) continue;
    if (isGalaxyDistancePairKey(k)) {
      out[k] = d;
      continue;
    }
    if (k.includes("\0")) {
      const parts = k.split("\0");
      if (parts.length === 2 && parts[0] && parts[1]) {
        const nk = galaxyDistancePairKey(parts[0], parts[1]);
        const prev = out[nk];
        if (prev == null || d < prev) out[nk] = d;
      }
    }
  }
  return out;
}

export function loadGalaxyDistanceCache(): Record<string, number> {
  try {
    const raw = storageGet(GALAXY_DIST_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return sanitizeGalaxyDistanceMap(parsed as Record<string, number>);
  } catch {
    return {};
  }
}

export function saveGalaxyDistanceCache(map: Record<string, number>): void {
  try {
    storageSet(GALAXY_DIST_CACHE_KEY, JSON.stringify(sanitizeGalaxyDistanceMap(map)));
  } catch {
    /* */
  }
}

export function clearGalaxyDistanceCache(): void {
  try {
    storageRemove(GALAXY_DIST_CACHE_KEY);
  } catch {
    /* */
  }
}

/** Ly from galaxy coord map — pair key (construction ref → seller), with scan fallback. */
export function lookupGalaxyDistanceLy(
  systemName: string,
  distanceBySystem: Record<string, number> | undefined,
  constructionRef?: string,
): number | null {
  if (!distanceBySystem) return null;
  const sellN = normSystemName(systemName);
  if (!sellN) return null;

  if (constructionRef?.trim()) {
    for (const pair of [
      galaxyDistancePairKey(constructionRef, systemName),
      legacyGalaxyDistancePairKey(constructionRef, systemName),
    ]) {
      const pd = distanceBySystem[pair];
      if (isKnownLy(pd)) return pd!;
    }
    /**
     * The caller asked how far this seller is from one specific site. Falling through to
     * the scan below answered a different question — the distance from whichever other
     * construction site happened to have a cached pair — and that number was then
     * displayed and filtered on as if it belonged to this site.
     * `bestGalaxyLyFromSites` is the function for "nearest of several sites".
     */
    return null;
  }

  let best: number | null = null;
  for (const [k, d] of Object.entries(distanceBySystem)) {
    if (!isKnownLy(d)) continue;
    let toN: string | null = null;
    const parsed = parseGalaxyDistancePairKey(k);
    if (parsed) toN = parsed.to;
    else if (k.includes("\0")) {
      const parts = k.split("\0");
      if (parts.length === 2) toN = parts[1]!;
    }
    if (!toN || toN !== sellN) continue;
    if (best == null || d! < best) best = d!;
  }
  return best;
}

/**
 * Straight-line hop from construction ref to seller system (Milky Way x/y/z).
 * Never uses saved index/Spansh Ly — those are often relative to a different ref. (Callers passed the saved Ly as a
 * third argument that was never read, which looked like a fallback; it went, audit 2026-10-22.)
 */
export function constructionHopLy(
  constructionRef: string,
  sellerSystem: string,
  distanceBySystem?: Record<string, number>,
): Ly {
  const refN = normSystemName(constructionRef);
  const sellN = normSystemName(sellerSystem);
  if (refN && sellN && refN === sellN) return 0;
  return lookupGalaxyDistanceLy(sellerSystem, distanceBySystem, constructionRef);
}

export function formatHopLy(dist: Ly | undefined, loading = false): string {
  if (!isKnownLy(dist)) return loading ? "…" : "—";
  return `${dist.toFixed(1)} Ly`;
}

/** 3D straight-line Ly from colonization site — null when coords not resolved yet (or no site is named). */
export function galaxyLyFromSite(
  sellerSystem: string,
  constructionSite: string,
  distanceMap: Record<string, number>,
): number | null {
  return constructionSite.trim() ? constructionHopLy(constructionSite, sellerSystem, distanceMap) : null;
}

/** Minimum 3D Ly from any construction site to the seller. */
export function bestGalaxyLyFromSites(
  sellerSystem: string,
  constructionSites: string[],
  distanceMap: Record<string, number>,
): number | null {
  const sell = sellerSystem.trim();
  if (!sell) return null;
  const sellN = normSystemName(sell);
  let best: number | null = null;
  for (const site of constructionSites) {
    const s = site.trim();
    if (!s) continue;
    if (normSystemName(s) === sellN) return 0;
    if (!Object.keys(distanceMap).length) continue;
    const d = lookupGalaxyDistanceLy(sell, distanceMap, s);
    if (d != null && (best == null || d < best)) best = d;
  }
  return best;
}
