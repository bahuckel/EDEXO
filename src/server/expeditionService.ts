/**
 * The expedition planner's service (plan 2.4, 2026-10-11): the shipped tables (`expedition.ts`) wired to the
 * galaxy index, the price list, the region map, the position catalogue and the ship, for `/api/expedition/*`.
 *
 * The server runs in Electron's main process, so the one long pass — the galaxy index's 1.7 M systems, to
 * count the recorded ones inside the field's boxels — runs in slices (`sliced.ts`), as the map's passes do.
 * A field is cached per position rounded to 10 ly, radius, species and codes, for ten minutes; the plan and
 * a boxel's candidates are cheap and not cached.
 */
import type { BioIndex } from "./bioIndex.js";
import { runSliced, SLICE } from "./sliced.js";
import { lookupPrice, type PriceIndex } from "./priceList.js";
import { regionForCoords, type RegionMapData } from "../shared/regionMap.js";
import { gateForSpeciesId, type SpatialCatalogue, type SpatialPoint } from "../shared/spatialGates.js";
import type { SpeciesEntry } from "../shared/types.js";
import { BOXEL_BIO_RATES } from "../shared/boxelBioRates.js";
import { MASS_CODE_LETTERS, type MassCode } from "../shared/boxelAdvice.js";
import { twoOptOrder } from "./tourOrder.js";
import type {
  ExpeditionBoxelDTO,
  ExpeditionCandidatesDTO,
  ExpeditionFieldDTO,
  ExpeditionPlanDTO,
} from "../shared/dto/expedition.js";
import {
  boxelEV,
  boxelEVForSpecies,
  boxelFromKey,
  boxelKey,
  boxelsWithin,
  candidateSystems,
  EXPEDITION_CODES,
  evPerJump,
  genusKey,
  genusValues,
  loadEvTable,
  loadSectorNames,
  RecordedCounter,
  type EvTable,
  type ExpeditionBoxel,
} from "./expedition.js";

type Xyz = { x: number; y: number; z: number };

export const MAX_RADIUS_LY = 3000;
export const DEFAULT_RADIUS_LY = 1000;
export const MAX_FIELD_BOXELS = 500;
/** Used when the journals have not shown a jump range yet. */
export const DEFAULT_JUMP_RANGE_LY = 50;
const CACHE_MS = 10 * 60_000;

export interface ExpeditionDeps {
  root: string;
  index: BioIndex | null;
  prices: PriceIndex;
  species: readonly SpeciesEntry[];
  regionMap: RegionMapData | null;
  catalogue: SpatialCatalogue | null;
}

/** How often each species is logged (EDAstro's codex counts over every mass code), by lower-case name. */
let logCounts: Map<string, number> | null = null;
function logCountsByName(): Map<string, number> {
  if (logCounts) return logCounts;
  logCounts = new Map();
  for (const m of Object.values(BOXEL_BIO_RATES)) {
    for (const [k, n] of Object.entries(m.all.hits)) {
      if (!k.startsWith("sp:")) continue;
      const name = k.slice(3).toLowerCase();
      logCounts.set(name, (logCounts.get(name) ?? 0) + n);
    }
  }
  return logCounts;
}

let valueMemo: { species: readonly SpeciesEntry[]; prices: PriceIndex; values: number[] } | null = null;
function genusValueTable(table: EvTable, deps: ExpeditionDeps): number[] {
  if (valueMemo?.species === deps.species && valueMemo.prices === deps.prices) return valueMemo.values;
  const counts = logCountsByName();
  const values = genusValues(
    table.genera,
    deps.species.map((e) => ({ genus: e.genus ?? "", name: e.displayName, price: lookupPrice(deps.prices, e.displayName, e.id) })),
    (name) => counts.get(name.toLowerCase()) ?? 0,
  );
  valueMemo = { species: deps.species, prices: deps.prices, values };
  return values;
}

/** A species' share of its genus by codex log counts (all mass codes), 0 when it has none logged. */
function shareInGenus(entry: SpeciesEntry, species: readonly SpeciesEntry[]): number {
  const counts = logCountsByName();
  const g = genusKey(entry.genus ?? "");
  const total = species.filter((e) => genusKey(e.genus ?? "") === g).reduce((a, e) => a + (counts.get(e.displayName.toLowerCase()) ?? 0), 0);
  return total > 0 ? (counts.get(entry.displayName.toLowerCase()) ?? 0) / total : 0;
}

/** Recorded systems per boxel near the field: the galaxy index, one sliced pass. */
async function recordedNear(index: BioIndex | null, from: Xyz, radiusLy: number, codes: readonly MassCode[]): Promise<RecordedCounter> {
  const counter = new RecordedCounter(from, radiusLy, codes);
  if (!index || !codes.length) return counter;
  const n = index.systemCount;
  const each = (_i: number, x: number, y: number, z: number) => counter.add(x, y, z);
  function* pass(): Generator<void, void> {
    if (!index!.forEachPointIn) {
      index!.forEachPoint(each);
      return;
    }
    for (let from0 = 0; from0 < n; from0 += SLICE) {
      index!.forEachPointIn(from0, Math.min(n, from0 + SLICE), each);
      yield;
    }
  }
  await runSliced(pass());
  return counter;
}

function dtoOf(
  b: ExpeditionBoxel,
  region: string | null,
  s: ReturnType<typeof boxelEV>,
  recorded: number,
  jumpRangeLy: number,
): ExpeditionBoxelDTO {
  const per = evPerJump(s, b.distanceLy, jumpRangeLy);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    key: boxelKey(b),
    code: b.code,
    name: b.name,
    mixed: b.mixed,
    center: { x: r1(b.center.x), y: r1(b.center.y), z: r1(b.center.z) },
    cubeLy: b.cubeLy,
    distanceLy: Math.round(b.distanceLy),
    region,
    systems: Math.round(s.systems),
    pBio: Math.round(s.pBio * 10000) / 10000,
    recorded,
    ev: Math.round(s.ev),
    jumps: per.jumps,
    evPerJump: Math.round(per.evPerJump),
    topGenera: s.topGenera.map((g) => ({ genus: g.genus, share: Math.round(g.share * 100) / 100 })),
  };
}

/**
 * The catalogue cut down to the points that can decide a gate inside the field: within the radius plus the
 * rule's reach plus the largest boxel's half-diagonal of the centre, and always the nearest one, so a gate
 * never meets an empty list (which reads as "nothing to check"). Same verdicts, a fraction of the distances:
 * radialem has 15,284 cluster records.
 */
export function catalogueNear(cat: SpatialCatalogue | null, center: Xyz, reachLy: number): SpatialCatalogue | null {
  if (!cat) return null;
  const near = (pts: SpatialPoint[] | undefined) => {
    if (!pts?.length) return pts;
    let best: SpatialPoint | null = null;
    let bestD = Infinity;
    const out: SpatialPoint[] = [];
    for (const p of pts) {
      const d = Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z);
      if (d <= reachLy) out.push(p);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return out.length ? out : [best!];
  };
  const records = cat.records ? Object.fromEntries(Object.entries(cat.records).map(([k, v]) => [k, near(v)!])) : undefined;
  return { ...cat, nebulae: near(cat.nebulae)!, guardian: near(cat.guardian)!, ...(records ? { records } : {}) };
}

const fieldCache = new Map<string, { at: number; value: ExpeditionFieldDTO }>();

export function clearExpeditionCache(): void {
  fieldCache.clear();
  valueMemo = null;
}

export function parseCodes(raw: unknown): MassCode[] {
  const s = String(raw ?? "").toLowerCase();
  const pick = MASS_CODE_LETTERS.filter((c) => s.includes(c));
  return pick.length ? pick : [...EXPEDITION_CODES];
}

/** The value field: every boxel within the radius, scored and ranked by credits per jump (or species bodies). */
export async function expeditionField(
  q: { from: Xyz; radiusLy: number; jumpRangeLy: number | null; speciesId?: string | null; minEv?: number; limit?: number; codes?: MassCode[] },
  deps: ExpeditionDeps,
): Promise<ExpeditionFieldDTO> {
  const radiusLy = Math.max(10, Math.min(MAX_RADIUS_LY, q.radiusLy || DEFAULT_RADIUS_LY));
  const jumpRangeLy = q.jumpRangeLy && q.jumpRangeLy > 0 ? q.jumpRangeLy : DEFAULT_JUMP_RANGE_LY;
  const codes = q.codes?.length ? q.codes : [...EXPEDITION_CODES];
  const entry = q.speciesId ? (deps.species.find((e) => e.id === q.speciesId) ?? null) : null;
  const limit = Math.max(1, Math.min(MAX_FIELD_BOXELS, q.limit ?? MAX_FIELD_BOXELS));
  const key = [
    Math.round(q.from.x / 10), Math.round(q.from.y / 10), Math.round(q.from.z / 10),
    radiusLy, Math.round(jumpRangeLy), entry?.id ?? "", codes.join(""), q.minEv ?? 0, limit,
  ].join("|");
  const hit = fieldCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const table = loadEvTable(deps.root);
  const names = loadSectorNames(deps.root);
  const genusValue = genusValueTable(table, deps);
  const { boxels, skipped } = boxelsWithin(q.from, radiusLy, codes, names);
  const recorded = await recordedNear(deps.index, q.from, radiusLy, codes.filter((c) => !skipped.includes(c)));
  const share = entry ? shareInGenus(entry, deps.species) : 0;
  const gate = entry ? gateForSpeciesId(entry.id) : null;
  const catalogue = gate
    ? catalogueNear(deps.catalogue, q.from, radiusLy + gate.thresholdLy + (gate.records?.withinLy ?? 0) + 1280 * Math.sqrt(3) / 2)
    : deps.catalogue;
  const scored: ExpeditionBoxelDTO[] = [];
  for (const b of boxels) {
    const region = deps.regionMap ? regionForCoords(deps.regionMap, b.center.x, b.center.y, b.center.z) : null;
    const rec = recorded.countIn(b);
    const s = boxelEV(b, { table, region, genusValue, recorded: rec });
    const dto = dtoOf(b, region, s, rec, jumpRangeLy);
    if (entry) {
      const sp = boxelEVForSpecies(b, {
        table, region, genus: entry.genus ?? "", speciesId: entry.id, shareInGenus: share, catalogue, recorded: rec,
      });
      dto.speciesBodies = Math.round(sp.bodies * 1000) / 1000;
      dto.passesGate = sp.passesGate;
      if (!(sp.bodies > 0)) continue;
    } else if (dto.ev < (q.minEv ?? 0)) continue;
    scored.push(dto);
  }
  scored.sort(entry ? (a, b) => (b.speciesBodies ?? 0) / b.jumps - (a.speciesBodies ?? 0) / a.jumps : (a, b) => b.evPerJump - a.evPerJump);
  const value: ExpeditionFieldDTO = {
    from: q.from,
    radiusLy,
    jumpRangeLy,
    scored: scored.length,
    skipped,
    species: entry?.id ?? null,
    boxels: scored.slice(0, limit),
    builtAt: table.builtAt,
  };
  fieldCache.set(key, { at: Date.now(), value });
  if (fieldCache.size > 16) fieldCache.delete(fieldCache.keys().next().value!);
  return value;
}

/** Stops in flying order from the ship: nearest first, then 2-opt; straight-line legs and jump estimates. */
export function expeditionPlan(
  keys: readonly string[],
  q: { from: Xyz; jumpRangeLy: number | null; evOf?: (key: string) => number | null },
  deps: Pick<ExpeditionDeps, "root">,
): ExpeditionPlanDTO {
  const names = loadSectorNames(deps.root);
  const jumpRangeLy = q.jumpRangeLy && q.jumpRangeLy > 0 ? q.jumpRangeLy : DEFAULT_JUMP_RANGE_LY;
  const stops = [...new Set(keys)].slice(0, 20).map((k) => boxelFromKey(k, names, q.from)).filter((b): b is ExpeditionBoxel => !!b);
  const pts = stops.map((b) => b.center);
  const order = stops.length > 1 ? twoOptOrder(q.from, pts, false) : stops.map((_, i) => i);
  let prev = q.from;
  let totalLy = 0;
  let totalJumps = 0;
  const out = order.map((i) => {
    const b = stops[i]!;
    const legLy = Math.hypot(b.center.x - prev.x, b.center.y - prev.y, b.center.z - prev.z);
    const legJumps = Math.max(1, Math.ceil(legLy / jumpRangeLy));
    prev = b.center;
    totalLy += legLy;
    totalJumps += legJumps;
    return { key: boxelKey(b), name: b.name, center: b.center, legLy: Math.round(legLy), legJumps, ev: q.evOf?.(boxelKey(b)) ?? null };
  });
  return { from: q.from, jumpRangeLy, stops: out, totalLy: Math.round(totalLy), totalJumps };
}

/** One boxel's score and the system names in it nobody has recorded. */
export function expeditionCandidates(
  key: string,
  q: { from: Xyz; jumpRangeLy: number | null; knownNames: (prefix: string) => Set<string> },
  deps: ExpeditionDeps,
): ExpeditionCandidatesDTO | null {
  const table = loadEvTable(deps.root);
  const names = loadSectorNames(deps.root);
  const b = boxelFromKey(key, names, q.from);
  if (!b) return null;
  const region = deps.regionMap ? regionForCoords(deps.regionMap, b.center.x, b.center.y, b.center.z) : null;
  const known = b.name ? q.knownNames(b.name) : new Set<string>();
  const s = boxelEV(b, { table, region, genusValue: genusValueTable(table, deps) });
  const jumpRangeLy = q.jumpRangeLy && q.jumpRangeLy > 0 ? q.jumpRangeLy : DEFAULT_JUMP_RANGE_LY;
  return {
    boxel: dtoOf(b, region, s, 0, jumpRangeLy),
    candidates: candidateSystems(b, Math.max(s.systems, known.size), known),
    knownSystems: known.size,
  };
}
