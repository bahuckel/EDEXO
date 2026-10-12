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
import { gateForSpeciesId, type SpatialCatalogue, type SpatialGate, type SpatialPoint } from "../shared/spatialGates.js";
import type { SpeciesEntry } from "../shared/types.js";
import { BOXEL_BIO_RATES } from "../shared/boxelBioRates.js";
import { MASS_CODE_LETTERS, type MassCode } from "../shared/boxelAdvice.js";
import { twoOptOrder } from "./tourOrder.js";
import {
  boxelsAlong,
  expectedMatches,
  featureCellFor,
  loadFeatureTable,
  type ExpeditionTarget,
} from "./expeditionTargets.js";
import type {
  ExpeditionBoxelDTO,
  ExpeditionCandidatesDTO,
  ExpeditionFieldDTO,
  ExpeditionPlanDTO,
  ExpeditionRuleDTO,
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
  gridIdOf,
  RecordedCounter,
  systemPrefixOf,
  type EvTable,
  type ExpeditionBoxel,
} from "./expedition.js";
import { barrenIn, barrenNumbersIn, loadBarrenTable } from "./boxelBarren.js";

type Xyz = { x: number; y: number; z: number };

export const MAX_RADIUS_LY = 3000;
export const DEFAULT_RADIUS_LY = 1000;
export const MAX_FIELD_BOXELS = 500;
/** Used when the journals have not shown a jump range yet. */
export const DEFAULT_JUMP_RANGE_LY = 50;
/** A route's corridor: boxels within this of the line from A to B. */
export const DEFAULT_ROUTE_WIDTH_LY = 250;
export const MAX_ROUTE_WIDTH_LY = 1000;
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
  visited = 0,
  /** On a route: the extra distance of going by the boxel, which is what the jumps to reach it cost. */
  detourLy?: number,
): ExpeditionBoxelDTO {
  const per = evPerJump(s, detourLy ?? b.distanceLy, jumpRangeLy);
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
    visited,
    ...(s.barren > 0 ? { barren: s.barren } : {}),
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

const ly = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("en-US")} kly` : `${v} ly`);

/** A position rule in the reader's words: "within 150 ly of a nebula or 50 ly of a radialem cluster". */
export function ruleText(gate: SpatialGate): string {
  if (gate.kind === "core") return gate.beyond ? `at least ${ly(gate.thresholdLy)} from Sgr A*` : `within ${ly(gate.thresholdLy)} of Sgr A*`;
  const what = gate.kind === "nebula" ? "a nebula" : "a Guardian site";
  let t = `within ${ly(gate.thresholdLy)} of ${what}`;
  if (gate.records) t += ` or ${ly(gate.records.withinLy)} of a ${gate.records.label.replace(/^Electricae /, "")}`;
  if (gate.softBandLy) t += `, at ${Math.round((gate.softFactor ?? 0.5) * 100)} % of the chance out to ${ly(gate.softBandLy)}`;
  return t;
}

/** At most this many rule points go to the map (the nearest first): radialem has 15,284 cluster records. */
export const MAX_RULE_POINTS = 400;

/** The points a rule is measured from near the field, each with the radius it allows, nearest first. */
export function rulePoints(
  gate: SpatialGate,
  cat: SpatialCatalogue | null,
  from: Xyz,
  radiusLy: number,
): { points: ExpeditionRuleDTO["points"]; truncated: boolean } {
  if (!cat) return { points: [], truncated: false };
  const out: (ExpeditionRuleDTO["points"][number] & { d: number })[] = [];
  const add = (pts: readonly SpatialPoint[] | undefined, r: number) => {
    for (const p of pts ?? []) {
      const d = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
      if (d <= radiusLy + r) out.push({ name: p.n, x: p.x, y: p.y, z: p.z, radiusLy: r, d });
    }
  };
  if (gate.kind === "core") add([cat.core], gate.thresholdLy);
  else add(gate.kind === "nebula" ? cat.nebulae : cat.guardian, gate.softBandLy ?? gate.thresholdLy);
  if (gate.records) add(cat.records?.[gate.records.key], gate.records.withinLy);
  out.sort((a, b) => a.d - b.d);
  return { points: out.slice(0, MAX_RULE_POINTS).map(({ d: _d, ...p }) => p), truncated: out.length > MAX_RULE_POINTS };
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
  q: {
    from: Xyz;
    radiusLy: number;
    jumpRangeLy: number | null;
    speciesId?: string | null;
    minEv?: number;
    limit?: number;
    codes?: MassCode[];
    /** The commander's own visited systems: no first footfall left for him there. */
    visitedPoints?: readonly Xyz[];
    /** What to look for (plan 5.2); exobiology when absent. */
    target?: ExpeditionTarget;
    /** A route to this point instead of a sphere round `from`: boxels within `widthLy` of the line. */
    to?: Xyz | null;
    widthLy?: number;
  },
  deps: ExpeditionDeps,
): Promise<ExpeditionFieldDTO> {
  const radiusLy = Math.max(10, Math.min(MAX_RADIUS_LY, q.radiusLy || DEFAULT_RADIUS_LY));
  const jumpRangeLy = q.jumpRangeLy && q.jumpRangeLy > 0 ? q.jumpRangeLy : DEFAULT_JUMP_RANGE_LY;
  const codes = q.codes?.length ? q.codes : [...EXPEDITION_CODES];
  const entry = q.speciesId ? (deps.species.find((e) => e.id === q.speciesId) ?? null) : null;
  const limit = Math.max(1, Math.min(MAX_FIELD_BOXELS, q.limit ?? MAX_FIELD_BOXELS));
  const target: ExpeditionTarget = q.target ?? { kind: "exobio" };
  const targetKey = target.kind === "body" ? `body:${target.body}` : target.kind === "star" ? `star:${target.star}` : target.kind === "value" ? `value:${target.minM}` : "exobio";
  const to = q.to ?? null;
  const widthLy = Math.max(50, Math.min(MAX_ROUTE_WIDTH_LY, q.widthLy || DEFAULT_ROUTE_WIDTH_LY));
  const key = [
    targetKey,
    to ? `${Math.round(to.x / 10)},${Math.round(to.y / 10)},${Math.round(to.z / 10)},${widthLy}` : "",
    Math.round(q.from.x / 10), Math.round(q.from.y / 10), Math.round(q.from.z / 10),
    radiusLy, Math.round(jumpRangeLy), entry?.id ?? "", codes.join(""), q.minEv ?? 0, limit, q.visitedPoints?.length ?? 0,
    deps.index ? 1 : 0,
  ].join("|");
  const hit = fieldCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const table = loadEvTable(deps.root);
  const barrenTable = loadBarrenTable(deps.root);
  const names = loadSectorNames(deps.root);
  const genusValue = genusValueTable(table, deps);
  // A sphere round the ship, or a tube along the route (plan 5.2); the recorded systems are counted in a
  // sphere that holds either.
  const along = to ? boxelsAlong(q.from, to, widthLy, codes, names) : null;
  const { boxels, skipped } = along ?? boxelsWithin(q.from, radiusLy, codes, names);
  const mid = to ? { x: (q.from.x + to.x) / 2, y: (q.from.y + to.y) / 2, z: (q.from.z + to.z) / 2 } : q.from;
  const reach = to ? Math.hypot(to.x - q.from.x, to.y - q.from.y, to.z - q.from.z) / 2 + widthLy : radiusLy;
  const recorded = await recordedNear(deps.index, mid, reach, codes.filter((c) => !skipped.includes(c)));
  const mine = new RecordedCounter(mid, reach, codes.filter((c) => !skipped.includes(c)));
  const features = target.kind === "exobio" ? null : loadFeatureTable(deps.root);
  for (const p of q.visitedPoints ?? []) mine.add(p.x, p.y, p.z);
  const share = entry ? shareInGenus(entry, deps.species) : 0;
  const gate = entry ? gateForSpeciesId(entry.id) : null;
  const catalogue = gate
    ? catalogueNear(deps.catalogue, q.from, radiusLy + gate.thresholdLy + (gate.records?.withinLy ?? 0) + 1280 * Math.sqrt(3) / 2)
    : deps.catalogue;
  const scored: ExpeditionBoxelDTO[] = [];
  let passing = 0;
  for (const b of boxels) {
    const region = deps.regionMap ? regionForCoords(deps.regionMap, b.center.x, b.center.y, b.center.z) : null;
    const rec = recorded.countIn(b);
    const vis = mine.countIn(b);
    const barren = barrenIn(barrenTable, b.code, gridIdOf(b));
    const s = boxelEV(b, { table, region, genusValue, recorded: rec, visited: vis, barren });
    const routed = b as typeof b & { detourLy?: number; offLy?: number; t?: number };
    const dto = dtoOf(b, region, s, rec, jumpRangeLy, vis, routed.detourLy);
    if (routed.detourLy != null) {
      dto.detourLy = Math.round(routed.detourLy);
      dto.offLy = Math.round(routed.offLy ?? 0);
      dto.along = Math.round((routed.t ?? 0) * 1000) / 1000;
    }
    if (features) {
      const cell = featureCellFor(features, region, b.code);
      // A bio system carries the boxel's exobiology: its EV over the bio systems expected in it.
      const bioSystems = Math.max(0, s.remaining * s.pBio - s.recorded);
      const m = expectedMatches(target, cell, features, s.remaining, {
        p: s.remaining > 0 ? bioSystems / s.remaining : 0,
        perBioSystem: bioSystems > 0 ? s.ev / bioSystems : 0,
      });
      if (!(m > 0)) continue;
      dto.matches = Math.round(m * 1000) / 1000;
      dto.matchesPerJump = Math.round((m / dto.jumps) * 10000) / 10000;
      scored.push(dto);
      continue;
    }
    if (entry) {
      const sp = boxelEVForSpecies(b, {
        table, region, genus: entry.genus ?? "", speciesId: entry.id, shareInGenus: share, catalogue, recorded: rec, barren,
      });
      dto.speciesBodies = Math.round(sp.bodies * 1000) / 1000;
      dto.passesGate = sp.passesGate;
      if (sp.passesGate) passing++;
      // Under half a thousandth of a body reads 0.000 in the list: not worth a row.
      if (!(dto.speciesBodies > 0)) continue;
    } else if (dto.ev < (q.minEv ?? 0)) continue;
    scored.push(dto);
  }
  scored.sort(
    features
      ? (a, b) => (b.matchesPerJump ?? 0) - (a.matchesPerJump ?? 0)
      : entry
        ? (a, b) => (b.speciesBodies ?? 0) / b.jumps - (a.speciesBodies ?? 0) / a.jumps
        : (a, b) => b.evPerJump - a.evPerJump,
  );
  const value: ExpeditionFieldDTO = {
    from: q.from,
    radiusLy,
    jumpRangeLy,
    scored: scored.length,
    skipped,
    species: entry?.id ?? null,
    target: targetKey,
    to: to ? { x: to.x, y: to.y, z: to.z } : null,
    widthLy: to ? widthLy : null,
    rule: gate
      ? { text: ruleText(gate), ...rulePoints(gate, deps.catalogue, q.from, radiusLy), boxelsChecked: boxels.length, boxelsPassing: passing }
      : null,
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
  const barrenTable = loadBarrenTable(deps.root);
  // The ones flown since 2025 without biology are known too: no name of theirs in the copy list.
  if (b.name) for (const n of barrenNumbersIn(barrenTable, b.code, gridIdOf(b))) known.add(`${systemPrefixOf(b.name)}${n}`.toLowerCase());
  const s = boxelEV(b, { table, region, genusValue: genusValueTable(table, deps), barren: barrenIn(barrenTable, b.code, gridIdOf(b)) });
  const jumpRangeLy = q.jumpRangeLy && q.jumpRangeLy > 0 ? q.jumpRangeLy : DEFAULT_JUMP_RANGE_LY;
  return {
    boxel: dtoOf(b, region, s, 0, jumpRangeLy),
    candidates: candidateSystems(b, Math.max(s.systems, known.size), known),
    knownSystems: known.size,
  };
}
