/**
 * The matcher's numeric helpers: codex ranges with their 2 % tolerance, species and planet temperature bands, the
 * corpus check at a temperature edge, and the body values the measured-exclusion rules read. Moved out of
 * matchSpecies.ts unchanged (2026-10-27: the file was 16 lines from its size cap); matchSpecies.ts re-exports the
 * public ones.
 */
import type { PlanetScan, SpeciesCriterion, SpeciesEntry, SpeciesMatchContext } from "../shared/types.js";
import { gameTemperatureCeilingK } from "../shared/gameLimits.js";
import { observedNearTemperature } from "./speciesTemperatureObservations.js";
import type { ExclusionValues } from "./measuredExclusions.js";
import { hostStarClassKey } from "../shared/hostStarClass.js";

const OPEN_LO = -1e15;
const OPEN_HI = 1e15;

/**
 * A species' temperature band as a person would read it: `≤190 K`, `160–190 K`, `≥300 K`.
 *
 * Built by hand inline once, and the open-low case printed the ceiling twice — a commander looking
 * at why Tubus was demoted on a 193 K body was told "species range is ≤190190 K". The number was
 * right and unreadable, which is the worst way for an explanation to fail: it looks like the app is
 * confused rather than the sentence.
 */
export function describeTempBand(band: { lo: number; hi: number }): string {
  const openLo = band.lo === OPEN_LO;
  const openHi = band.hi === OPEN_HI;
  if (openLo && openHi) return "any temperature";
  if (openLo) return `≤${band.hi} K`;
  if (openHi) return `≥${band.lo} K`;
  return `${band.lo}–${band.hi} K`;
}

function inRange(v: number, min?: number, max?: number): boolean {
  if (min !== undefined && v < min) return false;
  if (max !== undefined && v > max) return false;
  return true;
}

/**
 * The owner's rule, in his words: "if it matches the ranges even within 2% it matches them. And is
 * thrown as a possibility, with a low chance."
 *
 * A value this close to the edge of a codex band sits inside the uncertainty of the band itself -
 * the codex numbers are rounded, and our surface temperature is often an estimate rather than a
 * measurement. Treating that as proof of absence throws away finds for a difference we cannot
 * actually resolve.
 */
export const NUMERIC_GATE_TOLERANCE = 0.02;

/**
 * `in` - inside the band. `near` - outside, but by no more than {@link NUMERIC_GATE_TOLERANCE} of
 * the edge it missed, so the candidate is demoted rather than dropped. `out` - beyond that.
 */
export function rangeFit(v: number, min?: number, max?: number): "in" | "near" | "out" {
  if (inRange(v, min, max)) return "in";
  const edge = min !== undefined && v < min ? min : max!;
  const slack = Math.abs(edge) * NUMERIC_GATE_TOLERANCE;
  return Math.abs(v - edge) <= slack ? "near" : "out";
}

/** Species band widened by the tolerance, for the band-vs-band temperature test. */
export function tempBandsOverlapWithinTolerance(
  planet: PlanetTemperatureBand,
  species: { lo: number; hi: number },
): boolean {
  const lo = species.lo === OPEN_LO ? OPEN_LO : species.lo - Math.abs(species.lo) * NUMERIC_GATE_TOLERANCE;
  const hi = species.hi === OPEN_HI ? OPEN_HI : species.hi + Math.abs(species.hi) * NUMERIC_GATE_TOLERANCE;
  return planet.minK <= hi && lo <= planet.maxK;
}

export interface PlanetTemperatureBand {
  minK: number;
  maxK: number;
}

export function speciesTempBand(c: SpeciesCriterion): { lo: number; hi: number } | null {
  const st = c.surfaceTemperatureK;
  if (!st) return null;
  if (st.min === undefined && st.max === undefined) return null;
  return { lo: st.min ?? OPEN_LO, hi: gameTemperatureCeilingK(st.max) ?? OPEN_HI };
}

/**
 * Does the corpus place this species on the body's side of a codex temperature edge?
 *
 * `observedAtTemperature` answers from a display bin, and a display bin is wide — 18 K for Stratum
 * cucumisis. Where that bin lies wholly beyond the codex band (Fungoida stabitis above 424 K, the
 * case the rescue was built for) its observations are on the body's side, and it answers as before.
 * Where it **straddles** the edge it cannot: cucumisis's bin 180-198 K held 175 sightings, its own
 * bodies sit at 191 K and above on 99.7 % of 312, and the bin was admitting it on every 180-189 K
 * body — exactly where Stratum excutitus and limaxus live.
 *
 * So a straddling bin hands the question to the fine histogram: sightings within
 * `NEAR_TEMPERATURE_WINDOW_K` of the body and beyond the edge, measured against the same floor.
 * Paleas at 162.1 K finds the 33 bodies recorded at 162.6-165 K and is rescued; cucumisis at 184 K
 * finds none and is demoted — softly, since a thin record is not an impossibility.
 */
export function sightingsBeyondEdge(
  entry: SpeciesEntry,
  obs: { binLowK: number; binHighK: number },
  kelvin: number,
  lo: number | undefined,
  hi: number | undefined,
): { straddles: boolean; near: number | null } {
  if (lo !== undefined && kelvin < lo) {
    if (obs.binHighK <= lo) return { straddles: false, near: null };
    return { straddles: true, near: observedNearTemperature(entry, kelvin, { below: lo }) };
  }
  if (hi !== undefined && kelvin > hi) {
    if (obs.binLowK >= hi) return { straddles: false, near: null };
    return { straddles: true, near: observedNearTemperature(entry, kelvin, { above: hi }) };
  }
  return { straddles: false, near: null };
}

export function speciesNeedsTemperatureGate(c: SpeciesCriterion): boolean {
  return speciesTempBand(c) !== null;
}

/** Planet band vs species band: overlap ⇒ inhabitable somewhere on the body. */
export function tempBandsOverlap(planet: PlanetTemperatureBand, species: { lo: number; hi: number }): boolean {
  return planet.minK <= species.hi && species.lo <= planet.maxK;
}

/**
 * The body's temperature for matching: the journal's reading when there is one.
 *
 * The estimator used to win this contest whenever it produced anything, and it produced a band a
 * mean **137 K** wide (p90 291 K). Worse, measured across 13,271 scanned bodies, the journal's own
 * `SurfaceTemperature` falls **outside** that estimated band on **28.8 %** of them — so the matcher
 * was discarding a measurement in favour of a guess that disagreed with it more than a quarter of
 * the time.
 *
 * It was compensation for bands that were too narrow to trust, and the compensation cost more than
 * the problem: dropping it cuts mean ambiguity from 11.16 to 7.51 and p90 from 33 to 16, and raises
 * decidability from 31.4 % to 34.6 %. It is not free — 10 confirmed species and 85.9 M credits move
 * out of the default list, 4 of them into the unlikely tier rather than out of the app — and the
 * owner took that trade explicitly.
 *
 * The estimator is still computed and still shown: `estimatedSurfaceTempK` rides the snapshot for
 * display, and it is the only band available on a body the commander has not scanned in detail.
 */
export function resolvePlanetTemperatureBand(
  scan: PlanetScan,
  est: { tMin: number; tMax: number } | null,
): PlanetTemperatureBand | null {
  if (scan.SurfaceTemperature != null && !Number.isNaN(scan.SurfaceTemperature)) {
    const t = scan.SurfaceTemperature;
    return { minK: t, maxK: t };
  }
  if (est) return { minK: est.tMin, maxK: est.tMax };
  return null;
}

type ShareRow = { Name?: string; name?: string; Percent?: number; percent?: number };
/*
  The gas and material shares per scan array, built once: the matcher reads them for every species on a body, and
  rebuilding them was most of exclusionValues' 224 ms in a 15-system first view (2026-10-19). Keyed by the array (a
  scan with new rows is a new key), one map per prefix; callers only read the result.
*/
const sharesMemo = { gas_: new WeakMap<object, Record<string, number>>(), mat_: new WeakMap<object, Record<string, number>>() };

/** Name → share in %, keys `prefix` + the name lower-cased without spaces; undefined when the scan lists none. */
function shares(rows: ShareRow[] | undefined, prefix: "gas_" | "mat_"): Record<string, number> | undefined {
  if (!Array.isArray(rows) || !rows.length) return undefined;
  const memo = sharesMemo[prefix];
  const hit = memo.get(rows);
  if (hit) return hit;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const name = String(r?.Name ?? r?.name ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const pct = r?.Percent ?? r?.percent;
    if (name && typeof pct === "number" && Number.isFinite(pct)) out[prefix + name] = Math.max(out[prefix + name] ?? 0, pct);
  }
  memo.set(rows, out);
  return out;
}

/** The body values the measured-exclusion rules test, in the units of their table. */
export function exclusionValues(scan: PlanetScan, ctx: SpeciesMatchContext | undefined): ExclusionValues {
  const num = (v: unknown, k = 1): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v * k : undefined;
  const metal = scan.composition?.Metal ?? scan.composition?.metal;
  return {
    temp: num(scan.SurfaceTemperature),
    mass: num(scan.MassEM),
    parent: ctx?.parentKind,
    sma_ls: num(scan.SemiMajorAxis, 1 / 299_792_458),
    orb_d: typeof scan.OrbitalPeriod === "number" ? num(Math.abs(scan.OrbitalPeriod), 1 / 86_400) : undefined,
    dist_ls: num(scan.distanceFromArrivalLs) ?? num(ctx?.distanceFromArrivalLs),
    grav_g: num(scan.SurfaceGravity, 1 / 9.80665),
    c_metal: num(metal),
    host: hostStarClassKey(ctx?.parentStarType) ?? undefined,
    main: ctx?.systemMainStarClass,
    region: ctx?.regionName,
    press_atm: num(scan.SurfacePressure, 1 / 101_325),
    radius_km: num(scan.radius, 1 / 1000),
    ecc: num(scan.Eccentricity),
    rot_d: typeof scan.RotationPeriod === "number" ? num(Math.abs(scan.RotationPeriod), 1 / 86_400) : undefined,
    c_ice: num(scan.composition?.Ice ?? scan.composition?.ice),
    c_rock: num(scan.composition?.Rock ?? scan.composition?.rock),
    gas: shares(scan.atmosphereComposition, "gas_"),
    mat: shares(scan.materials, "mat_"),
  };
}
