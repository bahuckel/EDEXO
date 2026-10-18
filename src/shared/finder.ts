/**
 * The galaxy map's system finder (plan docs/plan-finder-1.2.20.md; owner, 2026-10-19): systems within a radius of a
 * reference — the commander's colonies, a system picked on the map, or every colonised system — filtered by what
 * their bodies are, without the systems someone already colonised or claimed.
 *
 * The counts come from `finder.bin` (docs/perf/build_finder.py, from the Spansh dump): bodies Spansh lists, so every
 * count is a floor; "fully scanned" marks the systems whose listed bodies reach the system's own body count.
 */

/** Per-system counts the file holds, in its u8 column names (docs/perf/build_finder.py U8_COLUMNS). */
export const FINDER_COUNT_KEYS = [
  "elw",
  "ww",
  "aw",
  "water_giant",
  "gg1",
  "gg2",
  "gg3",
  "gg4",
  "gg5",
  "gg_water_life",
  "gg_ammonia_life",
  "helium_gg",
  "helium_rich",
  "hmc",
  "metal_rich",
  "rocky",
  "rocky_ice",
  "icy",
  "ringed",
  "landable",
  "landable_atmo",
  "terraformable",
  "bio",
  "geo",
  "stars",
  "planets",
] as const;
export type FinderCountKey = (typeof FINDER_COUNT_KEYS)[number];

/** Filters that are sums of columns, not a column of their own. */
export const FINDER_DERIVED_KEYS = ["gg_any", "bodies"] as const;
export type FinderDerivedKey = (typeof FINDER_DERIVED_KEYS)[number];
export type FinderMinKey = FinderCountKey | FinderDerivedKey;

/** The gas giants "any gas giant" adds up (water giants are listed on their own, as the game does). */
export const FINDER_GAS_GIANTS: readonly FinderCountKey[] = [
  "gg1",
  "gg2",
  "gg3",
  "gg4",
  "gg5",
  "gg_water_life",
  "gg_ammonia_life",
  "helium_gg",
  "helium_rich",
];

export interface FinderFilterDef {
  key: FinderMinKey;
  label: string;
  group: "Bodies" | "Gas giants" | "Features" | "Signals";
}

/** The picker, in display order. */
export const FINDER_FILTERS: readonly FinderFilterDef[] = [
  { key: "bodies", label: "Known bodies", group: "Bodies" },
  { key: "planets", label: "Planets", group: "Bodies" },
  { key: "stars", label: "Stars", group: "Bodies" },
  { key: "elw", label: "Earth-like world", group: "Bodies" },
  { key: "ww", label: "Water world", group: "Bodies" },
  { key: "aw", label: "Ammonia world", group: "Bodies" },
  { key: "hmc", label: "High metal content", group: "Bodies" },
  { key: "metal_rich", label: "Metal-rich", group: "Bodies" },
  { key: "rocky", label: "Rocky", group: "Bodies" },
  { key: "rocky_ice", label: "Rocky ice", group: "Bodies" },
  { key: "icy", label: "Icy", group: "Bodies" },
  { key: "gg_any", label: "Any gas giant", group: "Gas giants" },
  { key: "gg1", label: "Class I", group: "Gas giants" },
  { key: "gg2", label: "Class II", group: "Gas giants" },
  { key: "gg3", label: "Class III", group: "Gas giants" },
  { key: "gg4", label: "Class IV", group: "Gas giants" },
  { key: "gg5", label: "Class V", group: "Gas giants" },
  { key: "gg_water_life", label: "Water-based life", group: "Gas giants" },
  { key: "gg_ammonia_life", label: "Ammonia-based life", group: "Gas giants" },
  { key: "helium_rich", label: "Helium-rich", group: "Gas giants" },
  { key: "helium_gg", label: "Helium", group: "Gas giants" },
  { key: "water_giant", label: "Water giant", group: "Gas giants" },
  { key: "ringed", label: "Ringed bodies", group: "Features" },
  { key: "landable", label: "Landable", group: "Features" },
  { key: "landable_atmo", label: "Landable with atmosphere", group: "Features" },
  { key: "terraformable", label: "Terraformable", group: "Features" },
  { key: "bio", label: "Bodies with biology", group: "Signals" },
  { key: "geo", label: "Bodies with geology", group: "Signals" },
];

export const FINDER_RADIUS_MIN = 15;
export const FINDER_RADIUS_MAX = 150;
export const FINDER_RADIUS_STEP = 5;
export const FINDER_LIMIT_MAX = 1000;

/** File flags (build_finder.py FLAG_*). */
export const FINDER_FLAG = { populated: 1, colonised: 2, claimed: 4, frontier: 8, fullyScanned: 16 } as const;

export type FinderReferenceKind = "mine" | "picked" | "colonised";

export interface FinderQuery {
  reference: FinderReferenceKind;
  /** For "picked": the system's name, and where it is when the map knows (else the server looks the name up). */
  picked?: string;
  pickedAt?: { x: number; y: number; z: number };
  radiusLy: number;
  /** At least this many, per filter; 0 or absent = no limit. */
  min: Partial<Record<FinderMinKey, number>>;
  /** Main star class keys (STAR_CLASSES keys); empty = any. */
  mainStar: string[];
  /** Any of these star classes present somewhere in the system; empty = any. */
  starsPresent: string[];
  hideClaimed: boolean;
  fullyScanned: boolean;
  sort: "distance" | "bodies";
  limit: number;
}

export interface FinderHit {
  id64: string;
  name: string;
  x: number;
  y: number;
  z: number;
  /** To the nearest reference. */
  distLy: number;
  reference: string;
  mainStar: string | null;
  starsPresent: string[];
  counts: Record<FinderCountKey, number>;
  /** Bodies Spansh lists (stars + planets) and the system's own body count when known. */
  listed: number;
  bodyCount: number | null;
  fullyScanned: boolean;
  colonised: boolean;
  claimed: boolean;
}

export interface FinderResult {
  hits: FinderHit[];
  /** Systems that passed every filter (hits is the first `limit` of them). */
  matched: number;
  references: { name: string; x: number; y: number; z: number }[];
  /** The search stopped at its time budget; the list is what it found so far. */
  partial: boolean;
  /** Why nothing could be searched (no file, no colonies, the picked system unknown or outside the file's area). */
  problem: string | null;
  /** The data's dates, for "as of" in the drawer. */
  dump: string | null;
  builtAt: string | null;
}

/** Clamp and fill a query from the URL / the client (never trusted as sent). */
export function normaliseFinderQuery(raw: Partial<FinderQuery>): FinderQuery {
  const r = Number(raw.radiusLy);
  const radius = Number.isFinite(r)
    ? Math.min(FINDER_RADIUS_MAX, Math.max(FINDER_RADIUS_MIN, Math.round(r / FINDER_RADIUS_STEP) * FINDER_RADIUS_STEP))
    : 50;
  const min: Partial<Record<FinderMinKey, number>> = {};
  const keys = new Set<string>([...FINDER_COUNT_KEYS, ...FINDER_DERIVED_KEYS]);
  for (const [k, v] of Object.entries(raw.min ?? {})) {
    const n = Math.floor(Number(v));
    if (keys.has(k) && Number.isFinite(n) && n > 0) min[k as FinderMinKey] = Math.min(255, n);
  }
  const strs = (a: unknown) => (Array.isArray(a) ? a.filter((s): s is string => typeof s === "string").slice(0, 32) : []);
  const l = Math.floor(Number(raw.limit));
  return {
    reference: raw.reference === "picked" || raw.reference === "colonised" ? raw.reference : "mine",
    picked: typeof raw.picked === "string" ? raw.picked.trim().slice(0, 120) : undefined,
    pickedAt:
      raw.pickedAt && [raw.pickedAt.x, raw.pickedAt.y, raw.pickedAt.z].every((v) => typeof v === "number" && Number.isFinite(v))
        ? { x: raw.pickedAt.x, y: raw.pickedAt.y, z: raw.pickedAt.z }
        : undefined,
    radiusLy: radius,
    min,
    mainStar: strs(raw.mainStar),
    starsPresent: strs(raw.starsPresent),
    hideClaimed: raw.hideClaimed !== false,
    fullyScanned: raw.fullyScanned === true,
    sort: raw.sort === "bodies" ? "bodies" : "distance",
    limit: Number.isFinite(l) && l > 0 ? Math.min(FINDER_LIMIT_MAX, l) : 200,
  };
}
