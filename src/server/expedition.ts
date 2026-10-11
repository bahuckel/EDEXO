/**
 * The expedition planner's scoring (plan 2.3, 2026-10-11): what an unvisited boxel is worth in first
 * footfalls, from the ship's position. Pure functions over the shipped tables; the API (2.4) wires the
 * bio index, the price list and the ship.
 *
 * **The unit is the boxel.** An unvisited system is a procedural name and nothing else, and the name says
 * its mass code and boxel; everything predictable about it is a property of the boxel: how many systems it
 * holds and how often one carries biology, which genera, worth how much (`data/boxel/boxel-ev.json`, per
 * region x mass code, docs/perf/boxel_ev.py), and where it is (the species' position rules).
 *
 * ```
 * EV(boxel) = (systems x P(bio) - recorded bio systems) x bio bodies per bio system
 *             x value per bio body x 5 (first footfall)
 * value per bio body = sum_g (DSS'd bio bodies carrying g / DSS'd bio bodies) x value_g
 * ```
 * `value_g` is the genus's mean species value weighted by how often each species is logged (EDAstro's codex
 * counts, `boxelBioRates`). Recorded systems are the ones in the bio index inside the boxel: someone has
 * been, so the bonus is gone. Cells with too few known systems fall back to the mass code over all regions.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SECTOR_ORIGIN } from "../shared/sectorName.js";
import { boxelNameAt, boxelsPerAxis, boxelCubeLy, MASS_CODE_LETTERS, type MassCode } from "../shared/boxelAdvice.js";
import { evaluateSpatialGate, gateForSpeciesId, type SpatialCatalogue } from "../shared/spatialGates.js";

export interface EvCell {
  systems: number;
  known: number;
  bio: number;
  bioBodies: number;
  signals: number;
  dss: number;
  genera: number[];
  boxels?: number;
  sysPerBoxel?: number | null;
  boxelsEstimated?: number;
}

export interface EvTable {
  builtAt: string;
  genera: string[];
  byMass: Record<string, EvCell>;
  cells: Record<string, EvCell>;
}

export interface SectorNames {
  byCell: Map<string, { name: string; mixed: boolean }>;
}

type Xyz = { x: number; y: number; z: number };

export interface ExpeditionBoxel {
  code: MassCode;
  /** Sector cell on the 1,280 ly grid. */
  cell: [number, number, number];
  /** Boxel inside the sector: bx + 128 by + 16384 bz, as the procedural name encodes it. */
  position: number;
  /** "Phraa Blao AB-C d1", or null where the sector cell has no known name. */
  name: string | null;
  /** The cell is shared with a hand-named sector: the generated name may belong to that one instead. */
  mixed: boolean;
  center: Xyz;
  cubeLy: number;
  distanceLy: number;
}

/** A region cell needs this many known systems before its own rates are used over the mass code's. */
export const MIN_KNOWN = 2000;
/** And this many boxels with a size estimate before its systems-per-boxel is. */
export const MIN_BOXELS_ESTIMATED = 20;
export const FIRST_FOOTFALL_FACTOR = 5;

let evCache: { root: string; table: EvTable } | null = null;
let namesCache: { root: string; names: SectorNames } | null = null;

export function loadEvTable(root: string): EvTable {
  if (evCache?.root === root) return evCache.table;
  const table = JSON.parse(readFileSync(path.join(root, "data", "boxel", "boxel-ev.json"), "utf8")) as EvTable;
  evCache = { root, table };
  return table;
}

export function loadSectorNames(root: string): SectorNames {
  if (namesCache?.root === root) return namesCache.names;
  const doc = JSON.parse(readFileSync(path.join(root, "data", "boxel", "sector-names.json"), "utf8")) as {
    cells: [number, number, number, string, number][];
  };
  const names: SectorNames = { byCell: new Map(doc.cells.map(([x, y, z, name, mixed]) => [`${x},${y},${z}`, { name, mixed: mixed === 1 }])) };
  namesCache = { root, names };
  return names;
}

/** Roughly how many boxels of a code lie within a radius: the guard before enumerating them. */
export function boxelCountWithin(code: MassCode, radiusLy: number): number {
  const s = boxelCubeLy(code);
  return Math.ceil(((4 / 3) * Math.PI * radiusLy ** 3) / s ** 3);
}

/**
 * Every boxel of the given mass codes whose centre lies within `radiusLy` of `center`, nearest first. A
 * code that would give more than `maxPerCode` boxels is skipped and named in `skipped` (a-boxels are 10 ly
 * cubes: 500 ly holds half a million).
 */
export function boxelsWithin(
  center: Xyz,
  radiusLy: number,
  codes: readonly MassCode[],
  names: SectorNames | null,
  maxPerCode = 40_000,
): { boxels: ExpeditionBoxel[]; skipped: MassCode[] } {
  const out: ExpeditionBoxel[] = [];
  const skipped: MassCode[] = [];
  const o = SECTOR_ORIGIN;
  for (const code of codes) {
    if (boxelCountWithin(code, radiusLy) > maxPerCode) {
      skipped.push(code);
      continue;
    }
    const size = boxelCubeLy(code);
    const per = boxelsPerAxis(code);
    const lo = (v: number, oo: number) => Math.floor((v - radiusLy - oo) / size);
    const hi = (v: number, oo: number) => Math.floor((v + radiusLy - oo) / size);
    for (let gx = lo(center.x, o.x); gx <= hi(center.x, o.x); gx++)
      for (let gy = lo(center.y, o.y); gy <= hi(center.y, o.y); gy++)
        for (let gz = lo(center.z, o.z); gz <= hi(center.z, o.z); gz++) {
          const c = { x: o.x + (gx + 0.5) * size, y: o.y + (gy + 0.5) * size, z: o.z + (gz + 0.5) * size };
          const d = Math.hypot(c.x - center.x, c.y - center.y, c.z - center.z);
          if (d > radiusLy) continue;
          const cell: [number, number, number] = [Math.floor(gx / per), Math.floor(gy / per), Math.floor(gz / per)];
          const bx = gx - cell[0] * per;
          const by = gy - cell[1] * per;
          const bz = gz - cell[2] * per;
          const position = bx + 128 * by + 16384 * bz;
          const sector = names?.byCell.get(cell.join(",")) ?? null;
          out.push({
            code,
            cell,
            position,
            name: sector ? `${sector.name} ${boxelNameAt(code, position)}` : null,
            mixed: sector?.mixed ?? false,
            center: c,
            cubeLy: size,
            distanceLy: d,
          });
        }
  }
  out.sort((a, b) => a.distanceLy - b.distanceLy);
  return { boxels: out, skipped };
}

/** The key two boxels share when they are the same one. */
export function boxelKey(b: Pick<ExpeditionBoxel, "code" | "cell" | "position">): string {
  return `${b.code}:${b.cell.join(",")}:${b.position}`;
}

/** The boxel of a code a point falls in, as a key (for bucketing the bio index). */
export function boxelKeyAt(code: MassCode, p: Xyz): string {
  const size = boxelCubeLy(code);
  const per = boxelsPerAxis(code);
  const g = (v: number, o: number) => Math.floor((v - o) / size);
  const gx = g(p.x, SECTOR_ORIGIN.x);
  const gy = g(p.y, SECTOR_ORIGIN.y);
  const gz = g(p.z, SECTOR_ORIGIN.z);
  const cell = [Math.floor(gx / per), Math.floor(gy / per), Math.floor(gz / per)];
  const position = gx - cell[0]! * per + 128 * (gy - cell[1]! * per) + 16384 * (gz - cell[2]! * per);
  return `${code}:${cell.join(",")}:${position}`;
}

/**
 * Recorded systems per boxel, from points (the bio index's systems) near the field: one pass, only the
 * points within `radiusLy` + the largest cube of `center`, bucketed into the codes asked for.
 */
export function countRecorded(
  points: Iterable<Xyz>,
  center: Xyz,
  radiusLy: number,
  codes: readonly MassCode[],
): Map<string, number> {
  const reach = radiusLy + Math.max(...codes.map((c) => boxelCubeLy(c))) * 0.9;
  const out = new Map<string, number>();
  for (const p of points) {
    if (Math.abs(p.x - center.x) > reach || Math.abs(p.y - center.y) > reach || Math.abs(p.z - center.z) > reach) continue;
    for (const code of codes) {
      const k = boxelKeyAt(code, p);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

/** The table cell a boxel scores from: its region's when it has enough known systems, else its mass code's. */
export function evCellFor(table: EvTable, region: string | null, code: MassCode): { cell: EvCell; regional: boolean } {
  const c = region ? table.cells[`${region}|${code}`] : undefined;
  return c && c.known >= MIN_KNOWN && c.dss > 0 ? { cell: c, regional: true } : { cell: table.byMass[code]!, regional: false };
}

/** One genus's key across sources: "Bark Mounds" / "Bark Mound", "Amphora Plant" / "Amphora", any case. */
export function genusKey(g: string): string {
  return g.toLowerCase().replace(/[^a-z]/g, "").replace(/plant$/, "").replace(/s$/, "");
}

/**
 * Mean first-landing value of each genus in `genera` order (base credits, before the first footfall
 * factor): its species' values weighted by `weightOf` (codex log counts), a plain mean where none is known.
 */
export function genusValues(
  genera: readonly string[],
  species: readonly { genus: string; name: string; price: number | null }[],
  weightOf: (name: string) => number,
): number[] {
  return genera.map((g) => {
    const k = genusKey(g);
    const rows = species.filter((s) => genusKey(s.genus) === k && s.price != null && s.price > 0);
    if (!rows.length) return 0;
    const w = rows.map((s) => weightOf(s.name));
    const sum = w.reduce((a, x) => a + x, 0);
    return sum > 0
      ? rows.reduce((a, s, i) => a + s.price! * w[i]!, 0) / sum
      : rows.reduce((a, s) => a + s.price!, 0) / rows.length;
  });
}

export interface BoxelScore {
  /** Expected first-footfall credits in the boxel's unrecorded systems. */
  ev: number;
  systems: number;
  pBio: number;
  bioBodiesPerSystem: number;
  /** Expected bio systems already in the bio index (recorded), capped at the expected total. */
  recorded: number;
  /** The genera that carry most of the value, with their share of it. */
  topGenera: { genus: string; share: number }[];
  regional: boolean;
}

export function boxelEV(
  b: ExpeditionBoxel,
  ctx: { table: EvTable; region: string | null; genusValue: readonly number[]; recorded?: number },
): BoxelScore {
  const { cell, regional } = evCellFor(ctx.table, ctx.region, b.code);
  const base = ctx.table.byMass[b.code]!;
  const spb =
    regional && cell.sysPerBoxel && (cell.boxelsEstimated ?? 0) >= MIN_BOXELS_ESTIMATED ? cell.sysPerBoxel : (base.sysPerBoxel ?? 0);
  const pBio = cell.known > 0 ? cell.bio / cell.known : 0;
  const bodies = cell.bio > 0 ? cell.bioBodies / cell.bio : 0;
  const parts = cell.genera.map((n, i) => (cell.dss > 0 ? (n / cell.dss) * (ctx.genusValue[i] ?? 0) : 0));
  const perBody = parts.reduce((a, x) => a + x, 0);
  const expectedBio = spb * pBio;
  const recorded = Math.min(expectedBio, ctx.recorded ?? 0);
  const ev = (expectedBio - recorded) * bodies * perBody * FIRST_FOOTFALL_FACTOR;
  const topGenera = parts
    .map((v, i) => ({ genus: ctx.table.genera[i]!, share: perBody > 0 ? v / perBody : 0 }))
    .filter((g) => g.share > 0)
    .sort((a, c) => c.share - a.share)
    .slice(0, 3);
  return { ev, systems: spb, pBio, bioBodiesPerSystem: bodies, recorded, topGenera, regional };
}

/**
 * Credits per jump if the boxel is flown whole: the jumps to reach its centre plus one per system in it.
 * A huge boxel's total is large, and so is the flying it takes to collect it.
 */
export function evPerJump(score: Pick<BoxelScore, "ev" | "systems">, distanceLy: number, jumpRangeLy: number): { jumps: number; evPerJump: number } {
  const jumps = Math.max(1, Math.ceil(distanceLy / Math.max(1, jumpRangeLy))) + Math.max(1, Math.round(score.systems));
  return { jumps, evPerJump: score.ev / jumps };
}

/**
 * Does a species' position rule allow the boxel, with the boxel's half-diagonal as slack (any of its
 * systems may be on the right side)? True for a species without one.
 */
export function boxelPassesSpatialGate(speciesId: string, b: ExpeditionBoxel, catalogue: SpatialCatalogue | null): boolean {
  const gate = gateForSpeciesId(speciesId);
  if (!gate) return true;
  const v = evaluateSpatialGate(speciesId, b.center, catalogue);
  if (!v) return true;
  if (v.passes) return true;
  const slack = (b.cubeLy * Math.sqrt(3)) / 2;
  if (v.beyond) return v.distanceLy + slack >= v.thresholdLy;
  if (v.distanceLy - slack <= v.thresholdLy) return true;
  return !!v.record && v.record.distanceLy - slack <= v.record.withinLy;
}

/**
 * Expected bodies of one species in the boxel's unrecorded systems: the bio bodies the boxel holds x how
 * often a DSS'd bio body carries the genus x the species' share of its genus; nothing where its position
 * rule cannot be met.
 */
export function boxelEVForSpecies(
  b: ExpeditionBoxel,
  ctx: {
    table: EvTable;
    region: string | null;
    genus: string;
    speciesId: string;
    shareInGenus: number;
    catalogue: SpatialCatalogue | null;
    recorded?: number;
  },
): { bodies: number; passesGate: boolean } {
  const passesGate = boxelPassesSpatialGate(ctx.speciesId, b, ctx.catalogue);
  if (!passesGate) return { bodies: 0, passesGate };
  const s = boxelEV(b, { table: ctx.table, region: ctx.region, genusValue: [], recorded: ctx.recorded });
  const { cell } = evCellFor(ctx.table, ctx.region, b.code);
  const gi = ctx.table.genera.findIndex((g) => genusKey(g) === genusKey(ctx.genus));
  const pGenus = gi >= 0 && cell.dss > 0 ? cell.genera[gi]! / cell.dss : 0;
  const bioSystems = Math.max(0, s.systems * s.pBio - s.recorded);
  return { bodies: bioSystems * s.bioBodiesPerSystem * pGenus * ctx.shareInGenus, passesGate };
}

/**
 * The procedural names of a boxel's systems nobody has recorded, for the in-game target: `<boxel>-0` up to
 * the estimate of how many it holds, without the ones in `known` (case-insensitive), capped at `limit`.
 */
export function candidateSystems(b: ExpeditionBoxel, systems: number, known: ReadonlySet<string>, limit = 200): string[] {
  if (!b.name) return [];
  const out: string[] = [];
  const n = Math.max(1, Math.ceil(systems));
  for (let i = 0; i < n && out.length < limit; i++) {
    const name = `${b.name}-${i}`;
    if (!known.has(name.toLowerCase())) out.push(name);
  }
  return out;
}

export const EXPEDITION_CODES: readonly MassCode[] = MASS_CODE_LETTERS.filter((c) => c >= "c");
