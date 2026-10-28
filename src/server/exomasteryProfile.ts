import type {
  ExomasteryCompositionGroupDTO,
  ExomasteryCompositionSummaryDTO,
  ExomasteryDetailDTO,
  ExomasteryStatDetailDTO,
  ExomasteryStatDistributionDTO,
  ExomasteryVarietyItemDTO,
  ExplorationScanRecord,
  JournalHostStarObservation,
  PlanetScan,
} from "../shared/types.js";
import { journalPressureToAtm, journalSurfaceGravityToG } from "../shared/journalPhysics.js";
import { spectralKeysFromJournalStarType } from "../shared/starSpectralKeys.js";
import { foldSpelling } from "../shared/spelling.js";
import { hostStarClassKey, hostStarClassSimilarity } from "../shared/hostStarClass.js";
import {
  classifyHostMkPath,
  computeMkAxisStepDistance,
  harvardSpectralSlot,
  parseLooseSpectralMk,
  harvardSpectralStepDistance,
  stellarSubclassStepDistance,
  yerkesLuminosityStepDistance,
} from "../shared/stellarProximity.js";
import {
  cellIsUsable,
  type AtmosphereBandCell,
  type PercentileBand,
} from "../feeder/atmosphereBands.js";
import { exomasteryHabitatTierWeight } from "./exomasteryHabitatTiers.js";
import { loadHistogramEdges } from "./likelihoodData.js";
import { getProjectRoot } from "./paths.js";
import { shouldOmitExomasterySciencePath } from "./exomasteryPathHygiene.js";
import {
  AU_METERS,
  SECONDS_PER_DAY,
  journalSolidPercentFromRaw,
  valueForNumericPath,
  normalizeAtmosphereType,
  journalPercentNumber,
  crustMaterialValue,
  journalAtmosphereCompositionArray,
  atmoGasValue,
  journalCompositionObject,
  collectJournalMaterialElementNames,
  collectJournalAtmosphereGasNames,
  collectJournalSolidKeys,
  solidValue,
  valueForCategoricalPath,
} from "./exomasteryBodyValues.js";
import {
  modeCategoricalLabel,
  formatPathLabel,
  exomasteryPathTailLower,
  formatExomasteryValueForPath,
  formatExomasteryNum,
  relativePercentDisplay,
} from "./exomasteryFormat.js";
import { inferHostSpectralCohortMode } from "./exomasteryOtherMatch.js";
import { stripAtmosphereDensity } from "../shared/atmosphereText.js";
export { exomasteryOtherMatchCardDeckScore, buildOtherMatchDetailCards } from "./exomasteryOtherMatch.js";
export {
  formatPathLabel,
  exomasteryPathTailLower,
  exomasteryRollupValueDisplay,
  formatExomasteryValueForPath,
  exomasteryCompositionRollupDisplay,
  formatExomasteryNum,
} from "./exomasteryFormat.js";
export { valueForNumericPath, valueForCategoricalPath } from "./exomasteryBodyValues.js";

export {
  clearExomasteryProfileCache,
  exomasteryProfileCandidateFilenames,
  exomasterySpeciesLabelMatchesEntry,
  feederProfileBodyCount,
  hasExomasteryProfileFile,
  loadExomasteryProfile,
  maxExomasteryProfileSampleCount,
  resolveExomasteryExportBasename,
  resolveExomasteryProfileJsonPath,
  speciesSlug,
} from "./exomasteryProfileFile.js";
export type { ExomasteryNumericRollup, ExomasteryProfileV1 } from "./exomasteryProfileFile.js";
import type { ExomasteryNumericRollup, ExomasteryProfileV1 } from "./exomasteryProfileFile.js";

function similarityToRollup(v: number, r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const span = Math.max(r.max - r.min, Math.abs(mode) * 0.02, 1e-9);
  const d = Math.abs(v - mode);
  return Math.max(0, Math.min(1, 1 - d / span));
}

/**
 * The same shape as {@link similarityToRollup} with both of its estimators replaced.
 *
 * `mode` is the densest 0.1 K bucket over every body of the species — Tussock virgam's holds 4 of
 * 579 samples — and `max − min` is one outlier wide: Osseus discus reads 80–641 K because fourteen
 * methane bodies sit under 626 water ones. A span that wide makes every temperature look close to
 * the centre, so the term stops discriminating and the candidate survives on a parameter that should
 * have ruled it out.
 *
 * p50 and p1–p99 of the cell for *this body's atmosphere* are the same two quantities measured
 * where the question is actually asked.
 */
function similarityToBand(v: number, band: PercentileBand): number {
  const centre = band.p50;
  const halfWidth = Math.max((band.p99 - band.p1) / 2, Math.abs(centre) * 0.02, 1e-9);
  const d = Math.abs(v - centre);
  // Full credit at the centre, zero two half-widths out — so a body inside p1–p99 always scores > 0.
  return Math.max(0, Math.min(1, 1 - d / (2 * halfWidth)));
}

/** Crust / atmosphere / solid %: ≤1 percentage point from modal → full credit; then distance-scaled. */
function similarityToRollupComposition(v: number, r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const d = Math.abs(v - mode);
  if (d <= 1) return 1;
  const span = Math.max(r.max - r.min, Math.abs(mode) * 0.02, 1e-9);
  return Math.max(0, Math.min(1, 1 - d / span));
}

function normalizeCategoricalValueForCompare(path: string, val: string): string {
  const low = path.toLowerCase();
  const t = val.trim();
  if (low.includes("atmosphere") && !low.includes("composition")) {
    if (/^no atmosphere$/i.test(t) || /^none$/i.test(t)) return "No atmosphere";
  }
  return t;
}

/** Collapse thin vs thick atmospheric labels and CO₂ spellings for categorical matching. */
function normalizeAtmosphereCompareKey(path: string, val: string): string {
  if (!path.toLowerCase().includes("atmosphere") || path.toLowerCase().includes("composition")) {
    return normalizeCategoricalValueForCompare(path, val).toLowerCase().trim();
  }
  let t = stripAtmosphereDensity(normalizeCategoricalValueForCompare(path, val).toLowerCase().trim());
  t = t.replace(/\s+atmosphere$/, "");
  t = t.replace(/\bco2\b/g, "carbon dioxide");
  t = t.trim();
  /** Ammonia is the gas; "thin"/"thick" only describe pressure (handled separately via pressure stat). */
  if (t === "ammonia" || /^ammonia(\s|$)/.test(t)) t = "ammonia";
  /*
    Letters only, one spelling of sulphur. The journal writes `SulphurDioxide` and `ArgonRich`, the
    profiles "Thin Sulphur dioxide" and "Thin Argon-rich": compared with their spaces and hyphens,
    sulphur dioxide and every "-rich" atmosphere never matched, and that axis of the habitat score read
    0 on all of them (code review B7, 2026-09-27). "-rich" stays: Argon and Argon-rich are different.
  */
  return foldSpelling(t).replace(/[^a-z]/g, "");
}

/** Atmosphere *type* compare key for EDSM/CSV rows (thin/thick stripped; ammonia normalized). */
export function exomasteryAtmosphereTypeCompareKey(val: string): string {
  return normalizeAtmosphereCompareKey("body.atmosphere", val);
}

function categoricalSimilarity(scanVal: string, profileMode: string, path?: string): number {
  if (!path) {
    const a = scanVal.toLowerCase().trim();
    const b = profileMode.toLowerCase().trim();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    return 0;
  }
  const low = path.toLowerCase();
  if (low.includes("atmosphere") && !low.includes("composition")) {
    const a = normalizeAtmosphereCompareKey(path, scanVal);
    const b = normalizeAtmosphereCompareKey(path, profileMode);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    return 0;
  }
  if (
    /(\bhost\b.*\bstar\b)|(\bexo\.host)|(\bfeeder\b.*host.*star)|(primary[_.\s]*stellar)|(stellar.*spectral.*host)/i.test(
      low,
    )
  ) {
    const mkAxis = classifyHostMkPath(low);
    if (mkAxis && path) {
      const d = computeMkAxisStepDistance(mkAxis, profileMode, scanVal);
      if (d != null) {
        if (d === 0) return 1;
        if (d === 1) return 0.9;
        if (d === 2) return 0.75;
        if (d === 3) return 0.55;
        return 0.35;
      }
    }
    // Journal letters against EDSM labels: `F` against `F6`, `D` against `White Dwarf (DA) Star`.
    // Both sides are reduced to a class key first, because the fallback below is a substring test
    // and a single letter is a substring of almost any label.
    const classA = hostStarClassKey(scanVal);
    const classB = hostStarClassKey(profileMode);
    if (classA && classB) return hostStarClassSimilarity(classA, classB);

    const ka = spectralKeysFromJournalStarType(scanVal.trim());
    const kb = spectralKeysFromJournalStarType(profileMode.trim());
    if (ka.length && kb.length) {
      const a = ka.includes("TTS") ? "TTS" : ka[0]!;
      const b = kb.includes("TTS") ? "TTS" : kb[0]!;
      if (a === b) return 1;
      const ca = harvardSpectralSlot(a);
      const cb = harvardSpectralSlot(b);
      const hd = harvardSpectralStepDistance(ca, cb);
      if (hd != null) {
        if (hd === 0) return 1;
        if (hd === 1) return 0.9;
        if (hd === 2) return 0.75;
        if (hd === 3) return 0.55;
        return 0.35;
      }
      if (a.charAt(0) === b.charAt(0)) return 0.9;
      return 0;
    }
  }
  const a0 = normalizeCategoricalValueForCompare(path, scanVal);
  const b0 = normalizeCategoricalValueForCompare(path, profileMode);
  const a = a0.toLowerCase().trim();
  const b = b0.toLowerCase().trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  return 0;
}

function categoricalImportance(counts: Record<string, number>): number {
  const vals = Object.values(counts).filter((n) => n > 0);
  if (vals.length === 0) return 0.08;
  const total = vals.reduce((a, b) => a + b, 0);
  const mx = Math.max(...vals);
  return Math.max(0.06, mx / total);
}

function rollupImportance(r: ExomasteryNumericRollup): number {
  const c = r.count;
  const mc = r.modeCount;
  if (typeof c === "number" && c > 0 && typeof mc === "number" && mc > 0) {
    return Math.max(0.06, mc / c);
  }
  const mode = r.mode ?? r.mean;
  const span = (r.max - r.min) / (Math.abs(mode) + 1e-9);
  return Math.max(0.06, 1 / (1 + span));
}

function compositionChevron(
  current: number,
  mode: number,
  isMissing: boolean,
): "up" | "down" | "dash" | "none" {
  if (isMissing || !Number.isFinite(current) || !Number.isFinite(mode)) return "none";
  const d = Math.abs(current - mode);
  if (d <= 1) return "dash";
  return current > mode ? "up" : "down";
}

/**
 * The band cell for this body's atmosphere.
 *
 * Matched through the same normalisation the categorical scorer uses, because the two sides spell it
 * differently: EDSM writes "Thin Carbon dioxide" and the journal writes "CarbonDioxide". Null when
 * the profile predates the bands, the body has no atmosphere reading, or the cell is too thin to
 * describe a range — every one of which falls back to the pooled rollup rather than to nothing.
 */
function bandCellForScan(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): AtmosphereBandCell | null {
  const bands = profile.atmosphereBands;
  if (!bands) return null;
  const atmo = normalizeAtmosphereType(scan, rec);
  if (!atmo) return null;
  const want = exomasteryAtmosphereTypeCompareKey(atmo);
  if (!want) return null;
  for (const [key, cell] of Object.entries(bands)) {
    if (exomasteryAtmosphereTypeCompareKey(key) !== want) continue;
    return cellIsUsable(cell) ? cell : null;
  }
  return null;
}

/** Which band a numeric path should be scored against, when one is available. */
function bandForNumericPath(path: string, cell: AtmosphereBandCell | null): PercentileBand | null {
  if (!cell) return null;
  const low = path.toLowerCase();
  if (low.includes("surfacetemperature") || low.includes("surfacetemp")) return cell.surfaceTemperatureK;
  if (low.includes("surfacepressure")) return cell.surfacePressureAtm;
  /*
    Size and mass belong to the atmosphere cell too — see `AtmosphereBandCell`. Matched on the exact
    tail rather than `includes`, because the loop that calls this walks every numeric path and
    `body.solidComposition.Metal` must not be mistaken for a mass.

    `?? null` because a profile built before these fields existed has them undefined, and the caller
    reads null as "no cell for this path" and falls back to the pooled rollup — the old behaviour,
    unchanged, until that profile is rebuilt.
  */
  const tail = low.startsWith("body.") ? low.slice(5) : low;
  if (tail === "gravity") return cell.gravityG ?? null;
  if (tail === "radius") return cell.radiusKm ?? null;
  if (tail === "earthmasses") return cell.earthMasses ?? null;
  return null;
}

function collectWeightedHabitatScores(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): { score: number; importance: number }[] {
  const out: { score: number; importance: number }[] = [];

  const materialKeysLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  const atmoKeysLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  const solidKeysLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));

  /**
   * Measured importance scaled by the parameter's tier. Sample concentration says how *consistent* a
   * parameter is across the feeder sample, not how much it decides where a species grows; the tier
   * supplies the part concentration cannot know. See {@link exomasteryHabitatTierWeight}.
   */
  const push = (path: string, score: number, importance: number) => {
    out.push({ score, importance: importance * exomasteryHabitatTierWeight(path) });
  };

  const bandCell = bandCellForScan(profile, scan, rec);

  for (const [path, r] of Object.entries(profile.numerics)) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const tail = exomasteryPathTailLower(path);
    if (materialKeysLower.has(tail) || atmoKeysLower.has(tail) || solidKeysLower.has(tail)) continue;
    const v = valueForNumericPath(path, scan, rec);
    if (v == null) continue;
    // Temperature and pressure are scored against the cell for this body's atmosphere when there is
    // one; everything else, and every thin cell, still uses the pooled rollup.
    const band = bandForNumericPath(path, bandCell);
    push(path, band ? similarityToBand(v, band) : similarityToRollup(v, r), rollupImportance(r));
  }
  for (const [el, r] of Object.entries(profile.materials)) {
    const { v, known } = crustMaterialValue(scan, rec, el);
    if (!known) continue;
    push(`materials.${el}`, similarityToRollupComposition(v ?? 0, r), rollupImportance(r));
  }
  for (const [el, r] of Object.entries(profile.atmosphereComposition)) {
    const { v, known } = atmoGasValue(scan, rec, el);
    if (!known) continue;
    push(`atmosphereComposition.${el}`, similarityToRollupComposition(v ?? 0, r), rollupImportance(r));
  }
  for (const [el, r] of Object.entries(profile.solidComposition ?? {})) {
    const { v, known } = solidValue(scan, rec, el);
    if (!known) continue;
    push(`solidComposition.${el}`, similarityToRollupComposition(v ?? 0, r), rollupImportance(r));
  }
  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const modeVal = modeCategoricalLabel(counts);
    if (!modeVal) continue;
    const scanVal = valueForCategoricalPath(path, scan, rec, journalHost);
    if (!scanVal) continue;
    /**
     * Compared against the mode, not against the whole distribution.
     *
     * Expected similarity across every observed value is the more obvious model and it measured
     * worse: top-1 ranking fell from 108 of 405 species to 91, and putting a floor under the tail
     * (10 %, 20 %) recovered only half of that. Averaging over the tail flattens a sharp match into
     * a middling one, and ranking is a comparison between candidates — it needs the sharpness.
     */
    push(path, categoricalSimilarity(scanVal, modeVal, path), categoricalImportance(counts));
  }
  return out;
}

/** Small additive boosts on raw 0–1 habitat blend: tight solids / crust lines with presence.
 * Strict gate fields (planet class, atmosphere, temp, pressure) are **not** boosted here — they are already
 * enforced by `speciesMatchesCriteria` from genus JSON; boosting from `MatchReason` duplicated that signal
 * and kept weak exomastery fits from filtering (everything looked “non‑zero”).
 */
function computeHabitatExtraBoosts(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): number {
  let add = 0;
  let solidBonus = 0;
  for (const [el, rollup] of Object.entries(profile.solidComposition ?? {})) {
    const { v, known } = solidValue(scan, rec, el);
    if (!known) continue;
    const sim = similarityToRollupComposition(v ?? 0, rollup);
    if (sim >= 0.88) solidBonus += 0.014;
  }
  add += Math.min(0.042, solidBonus);

  let crustBonus = 0;
  for (const [el, rollup] of Object.entries(profile.materials)) {
    const cur = crustMaterialValue(scan, rec, el);
    if (!cur.known) continue;
    const bodyPct = cur.v ?? 0;
    if (bodyPct <= 0.01) continue;
    const sim = similarityToRollupComposition(bodyPct, rollup);
    if (sim >= 0.82) crustBonus += 0.0055;
  }
  add += Math.min(0.033, crustBonus);

  return Math.min(0.18, add);
}

/**
 * 0–100 weighted habitat match vs feeder profile (importance from mode concentration in exomastery data).
 * Does not apply same-genus deck display — see {@link applyExomasteryGenusCompetitivePercent}.
 */
export function exomasteryHabitatQualityPercent(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): number | null {
  const fields = collectWeightedHabitatScores(profile, scan, rec, journalHost);
  if (fields.length === 0) return null;
  const num = fields.reduce((s, f) => s + f.importance * f.score, 0);
  const den = fields.reduce((s, f) => s + f.importance, 0);
  if (den <= 0) return null;
  let q = num / den;
  q += computeHabitatExtraBoosts(profile, scan, rec);
  q = Math.max(0, Math.min(1, q));
  return Math.round(q * 1000) / 10;
}

/**
 * Top dimensions with the strongest central tendency in the feeder sample (spawn-variation hints).
 *
 * **The number shown is {@link ExomasteryProfileV1.parameterImportance} when the profile carries
 * it**, which is concentration measured against the corpus background and normalised by maximum
 * entropy (§25). The fallback below is the old magnitude proxy, `1 / (1 + span / 8)`, and §5.2b is
 * why it is only a fallback: it scores **argument of periapsis at 0.80** — a parameter that is
 * uniformly distributed and means nothing — because a small mean makes any span look tight.
 *
 * §21b.2 fixed the panel's *ordering* with tier weights. This fixes the *number*, which was still the
 * discredited one. Display only; the scorer has never read this function.
 */
/*
  The hints read the profile alone, and every candidate of every body asked for them anew (~4 % of a first view,
  profiled 2026-10-14). One answer per loaded profile; a reloaded profile is a new object, so it is asked again.
  Read-only to its callers: the rows carry it into the match as is.
*/
const varietyHintsMemo = new WeakMap<ExomasteryProfileV1, ExomasteryVarietyItemDTO[]>();

export function buildExomasteryVarietyHints(profile: ExomasteryProfileV1): ExomasteryVarietyItemDTO[] {
  const hit = varietyHintsMemo.get(profile);
  if (hit) return hit;
  const built = buildExomasteryVarietyHintsUncached(profile);
  varietyHintsMemo.set(profile, built);
  return built;
}

function buildExomasteryVarietyHintsUncached(profile: ExomasteryProfileV1): ExomasteryVarietyItemDTO[] {
  const rows: { label: string; concentration: number; rank: number }[] = [];
  // Lower-cased, because the loader hands back `rock` where the measured path is `…solidComposition.Rock`.
  const measured = new Map(
    Object.entries(profile.parameterImportance ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );

  /**
   * Ranked by tier-weighted concentration, displayed with the true one. A tightly clustered orbital
   * period is a real fact about the sample and stays in the list, but it must not head a panel the
   * commander reads as "what this species cares about" - the same demotion the scorer applies.
   */
  const addRow = (path: string, label: string, concentration: number) => {
    /**
     * A measured importance can be negative — the species is *less* concentrated on this parameter
     * than the galaxy at large — which is information the panel has no way to draw. Clamped to zero
     * so such a row sinks rather than sorting as if it were strongly negative-tight.
     */
    const m = measured.get(path.toLowerCase());
    /**
     * Measured where the profile has it, the old proxy where it does not.
     *
     * Dropping unmeasured rows instead was tried and rejected: 13 of the 93 shipped profiles carry no
     * `parameterImportance` at all, and it emptied their panel completely. Falling back leaves those
     * rows exactly as they are today and improves every row that has a measurement, which is a change
     * with no case that gets worse.
     */
    const shown = m !== undefined ? Math.max(0, m) * 100 : concentration;
    rows.push({ label, concentration: shown, rank: shown * exomasteryHabitatTierWeight(path) });
  };

  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const vals = Object.values(counts).filter((n) => n > 0);
    if (vals.length === 0) continue;
    const total = vals.reduce((a, b) => a + b, 0);
    const mx = Math.max(...vals);
    addRow(path, formatPathLabel(path), (mx / total) * 100);
  }

  /**
   * The profile's own path for a rollup the loader has already split into bare keys.
   *
   * `profile.materials` holds `Iron`, not `body.materials.Iron`, so this used to build
   * `crust.Iron` / `atmosphere.Carbon dioxide` — paths that exist nowhere else in the project. Two
   * things went wrong with that:
   *
   * 1. Measured importance is keyed on the real path, so none of these rows could ever find it.
   * 2. {@link exomasteryHabitatTier} promotes anything matching "atmosphere" *unless* it also says
   *    "composition" — the guard exists precisely to keep per-gas fractions out of the primary
   *    tier — and `atmosphere.Carbon dioxide` slipped through it. Carbon dioxide was heading the
   *    panel for Tussock ignis on a tier weight it was never meant to have.
   */
  const rollupPath = (labelPrefix: string, key: string): string => {
    if (labelPrefix === "Stat") return key;
    if (labelPrefix === "Crust") return `body.materials.${key}`;
    if (labelPrefix === "Atmosphere") return `body.atmosphereComposition.${key}`;
    return `body.solidComposition.${key}`;
  };

  const addNumericTightness = (labelPrefix: string, map: Record<string, ExomasteryNumericRollup>) => {
    for (const [k, r] of Object.entries(map)) {
      const pathKey = rollupPath(labelPrefix, k);
      if (shouldOmitExomasterySciencePath(pathKey)) continue;
      // Only reached when the profile has no measured importance for this path; see the header.
      const mode = r.mode ?? r.mean;
      const span = (r.max - r.min) / (Math.abs(mode) + 1e-9);
      const tight = 1 / (1 + span / 8);
      addRow(pathKey, `${labelPrefix} · ${k}`, tight * 100);
    }
  };
  addNumericTightness("Stat", profile.numerics);
  addNumericTightness("Crust", profile.materials);
  addNumericTightness("Atmosphere", profile.atmosphereComposition);
  addNumericTightness("Solid", profile.solidComposition ?? {});

  rows.sort((a, b) => b.rank - a.rank || b.concentration - a.concentration);
  return rows.map((r, i) => ({
    id: `exo-var-${i}-${r.label.replace(/[^a-z0-9]+/gi, "-").slice(0, 48)}`,
    label: r.label,
    concentrationPercent: Math.round(r.concentration * 10) / 10,
  }));
}

function summarizeCompositionMatch(
  items: { label: string; score: number }[],
): ExomasteryCompositionSummaryDTO {
  if (items.length === 0) {
    return { overallMatchPercent: null, best: null, worst: null };
  }
  const avg = items.reduce((s, x) => s + x.score, 0) / items.length;
  const sorted = [...items].sort((a, b) => a.score - b.score);
  const worst = sorted[0]!;
  const best = sorted[sorted.length - 1]!;
  return {
    overallMatchPercent: Math.round(avg * 10) / 10,
    best: { label: best.label, matchPercent: Math.round(best.score * 10) / 10 },
    worst: { label: worst.label, matchPercent: Math.round(worst.score * 10) / 10 },
  };
}

function statsHaveMkAxis(
  stats: ExomasteryStatDetailDTO[],
  axis: NonNullable<ReturnType<typeof classifyHostMkPath>>,
): boolean {
  return stats.some((s) => s.kind === "categorical" && classifyHostMkPath(s.chartPath ?? "") === axis);
}

function buildSupplementalHostMkRows(
  stats: ExomasteryStatDetailDTO[],
  profile: ExomasteryProfileV1,
  journalHost: JournalHostStarObservation | null | undefined,
  nid: () => string,
): ExomasteryStatDetailDTO[] {
  if (!journalHost) return [];
  const cohort = inferHostSpectralCohortMode(profile);
  const parsedCohort = parseLooseSpectralMk(cohort ?? "");
  const out: ExomasteryStatDetailDTO[] = [];

  const synthetic = (
    chartPath: string,
    label: string,
    typical: string,
    current: string,
    axis: NonNullable<ReturnType<typeof classifyHostMkPath>>,
    steps: number | null,
  ): ExomasteryStatDetailDTO => ({
    id: nid(),
    kind: "categorical",
    chartPath,
    label,
    typicalDisplay: typical,
    currentDisplay: current,
    isMissing: !current || !typical,
    diffPoints: null,
    diffRelativePercent: null,
    chevron: "none",
    compact: false,
    stellarProximitySteps: steps != null ? Math.min(4, steps) : null,
    stellarProximityAxis: axis,
    categoricalCloseness:
      steps === 0 ? "match" : steps === 1 ? "close" : steps != null && steps >= 2 ? "different" : undefined,
  });

  if (
    cohort &&
    !statsHaveMkAxis(stats, "spectral") &&
    journalHost.spectralLetter &&
    parsedCohort.spectralSlot
  ) {
    const st = harvardSpectralStepDistance(parsedCohort.spectralSlot, journalHost.spectralLetter);
    if (st != null) {
      out.push(
        synthetic(
          "host.compare.edsm.spectral_harvard",
          "Host spectral (Harvard · EDSM cohort vs journal)",
          parsedCohort.spectralSlot,
          journalHost.spectralLetter,
          "spectral",
          st,
        ),
      );
    }
  }

  if (!statsHaveMkAxis(stats, "subclass") && parsedCohort.subclass != null && journalHost.subclass != null) {
    const st = stellarSubclassStepDistance(parsedCohort.subclass, journalHost.subclass);
    if (st != null) {
      out.push(
        synthetic(
          "host.compare.edsm.subclass",
          "Host subclass (0–9 · EDSM cohort vs journal)",
          String(parsedCohort.subclass),
          String(journalHost.subclass),
          "subclass",
          st,
        ),
      );
    }
  }

  if (!statsHaveMkAxis(stats, "luminosity") && parsedCohort.luminosity && journalHost.luminosity) {
    const st = yerkesLuminosityStepDistance(parsedCohort.luminosity, journalHost.luminosity);
    if (st != null) {
      out.push(
        synthetic(
          "host.compare.edsm.luminosity_yerkes",
          "Host luminosity (Yerkes · EDSM cohort vs journal)",
          parsedCohort.luminosity,
          journalHost.luminosity,
          "luminosity",
          st,
        ),
      );
    }
  }

  return out;
}

/**
 * Bins for one parameter's chart: this species' own range first, the shared ruler as a fallback.
 *
 * The shared edges are quantiles of the whole corpus, so a species living inside one of them draws a
 * single featureless block — measured, and useless. The display histogram is the same observations
 * cut across the species' own min…max.
 */
function histogramForChart(
  profile: ExomasteryProfileV1,
  path: string,
): { counts: number[]; edges: number[] } | null {
  const own = profile.displayHistograms?.[path];
  if (own && own.counts.length > 1 && own.max > own.min) {
    const step = (own.max - own.min) / own.counts.length;
    const edges = Array.from({ length: own.counts.length - 1 }, (_, i) => own.min + step * (i + 1));
    return { counts: own.counts, edges };
  }
  const shared = loadHistogramEdges(getProjectRoot())?.edges[path];
  const counts = profile.histograms?.[path];
  return shared && counts && counts.length === shared.length + 1 ? { counts, edges: shared } : null;
}

export function buildNumericDistributionDto(
  displayPath: string,
  rollup: ExomasteryNumericRollup,
  current: number | null,
  histogram?: { counts: number[]; edges: number[] } | null,
): ExomasteryStatDistributionDTO | null {
  const mode = rollup.mode ?? rollup.mean;
  if (!Number.isFinite(rollup.min) || !Number.isFinite(rollup.max) || !Number.isFinite(mode)) return null;
  const lo = rollup.min;
  const hi = rollup.max;
  return {
    min: lo,
    max: hi,
    mode,
    current: current != null && Number.isFinite(current) ? current : null,
    displayPath,
    minLabel: formatExomasteryValueForPath(displayPath, lo),
    maxLabel: formatExomasteryValueForPath(displayPath, hi),
    ...(histogram ? { bins: distributionBins(histogram, lo, hi) } : {}),
  };
}

/**
 * Histogram bins clipped to what this species has actually been seen at (B7).
 *
 * The shipped edges are quantiles of the whole corpus, so the outermost bins are unbounded — a
 * species sitting in the top one would otherwise be drawn running off to infinity. Clipping to the
 * profile's own min and max keeps the picture about the species while the counts stay the measured
 * ones. Empty bins are kept: a gap in the middle *is* the finding.
 */
function distributionBins(
  histogram: { counts: number[]; edges: number[] },
  lo: number,
  hi: number,
): { x0: number; x1: number; count: number }[] {
  const { counts, edges } = histogram;
  const out: { x0: number; x1: number; count: number }[] = [];
  for (let i = 0; i < counts.length; i++) {
    const rawLo = i === 0 ? Number.NEGATIVE_INFINITY : edges[i - 1]!;
    const rawHi = i >= edges.length ? Number.POSITIVE_INFINITY : edges[i]!;
    const x0 = Math.max(lo, rawLo);
    const x1 = Math.min(hi, rawHi);
    if (!(x1 > x0)) continue;
    out.push({ x0, x1, count: counts[i] ?? 0 });
  }
  return out;
}

function compositionChartKeyToDistributionPath(chartKey: string): string {
  const k = chartKey.toLowerCase();
  if (k.startsWith("material:")) {
    const rest = chartKey.slice("material:".length);
    return rest.includes(".") ? rest : `body.materials.${rest}`;
  }
  if (k.startsWith("atmosphere:")) {
    const rest = chartKey.slice("atmosphere:".length);
    return rest.includes(".") ? rest : `body.atmosphereComposition.${rest}`;
  }
  if (k.startsWith("solid:")) {
    const rest = chartKey.slice("solid:".length);
    return rest.includes(".") ? rest : `body.solidComposition.${rest}`;
  }
  return chartKey;
}

function buildCompositionDistributionDto(
  chartKey: string,
  rollup: ExomasteryNumericRollup,
  cur: number | null,
  known: boolean,
): ExomasteryStatDistributionDTO | null {
  const mode = rollup.mode ?? rollup.mean;
  if (!Number.isFinite(rollup.min) || !Number.isFinite(rollup.max) || !Number.isFinite(mode)) return null;
  const lo = rollup.min;
  const hi = rollup.max;
  const fmt = (n: number) => `${formatExomasteryNum(n)}%`;
  return {
    min: lo,
    max: hi,
    mode,
    current: known && cur != null && Number.isFinite(cur) ? cur : null,
    displayPath: compositionChartKeyToDistributionPath(chartKey),
    minLabel: fmt(lo),
    maxLabel: fmt(hi),
  };
}

/** Current observation for a feeder profile display path (numerics + composition %). */
export function exomasteryObservationForProfilePath(
  displayPath: string,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): { value: number | null; known: boolean } {
  const low = displayPath.toLowerCase();
  // The composition helpers return { v, known }; this function's contract is { value, known }.
  // Returning them unmapped left `value` undefined, so every composition, atmosphere-gas and
  // material row in the exomastery cards read as "no observation" even when one existed.
  if (low.includes("solidcomposition") || low.includes("solid_composition")) {
    const tail = exomasteryPathTailLower(displayPath);
    const { v, known } = solidValue(scan, rec, tail);
    return { value: v, known };
  }
  if (low.includes("atmospherecomposition") || (low.includes("atmosphere") && low.includes("composition"))) {
    const tail = exomasteryPathTailLower(displayPath);
    const { v, known } = atmoGasValue(scan, rec, tail);
    return { value: v, known };
  }
  if (low.includes("materials")) {
    const tail = exomasteryPathTailLower(displayPath);
    const { v, known } = crustMaterialValue(scan, rec, tail);
    return { value: v, known };
  }
  const v = valueForNumericPath(displayPath, scan, rec);
  return { value: v, known: v != null };
}

/** Per-field breakdown for UI modal (numeric + categorical; composition in {@link ExomasteryDetailDTO.compositionGroups}). */
/**
 * Whether {@link buildExomasteryDetail} gives this profile at least one stat on any body: every numeric fact it
 * does not omit and that is not a composition tail becomes one, whatever the body. Read by the lazy detail
 * (lazyMatchDetail.ts) so the push can say "there is a habitat breakdown" without building it.
 */
export function exomasteryDetailAlwaysHasStats(profile: ExomasteryProfileV1): boolean {
  const comp = new Set([
    ...Object.keys(profile.materials).map((k) => k.toLowerCase()),
    ...Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()),
    ...Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()),
  ]);
  return Object.keys(profile.numerics).some(
    (path) => !shouldOmitExomasterySciencePath(path) && !comp.has(exomasteryPathTailLower(path)),
  );
}

export function buildExomasteryDetail(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): ExomasteryDetailDTO {
  const stats: ExomasteryStatDetailDTO[] = [];
  let idx = 0;
  const nid = () => `xo-${idx++}`;

  const materialKeysLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  const atmoKeysLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  const solidKeysLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));

  const atmosphereClimateStats: ExomasteryStatDetailDTO[] = [];
  const CLIMATE_NUMERIC_TAILS = new Set(["surfacegravity", "surfacetemperature", "surfacepressure"]);

  for (const [path, r] of Object.entries(profile.numerics)) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const tail = exomasteryPathTailLower(path);
    if (materialKeysLower.has(tail) || atmoKeysLower.has(tail) || solidKeysLower.has(tail)) continue;

    const v = valueForNumericPath(path, scan, rec);
    const mode = r.mode ?? r.mean;
    const missing = v == null || !Number.isFinite(v);
    const relDisp =
      !missing && Number.isFinite(mode) ? relativePercentDisplay(v!, mode) : { pct: null, huge: false };
    const curForDist = missing ? null : v!;
    const distribution = buildNumericDistributionDto(path, r, curForDist, histogramForChart(profile, path));
    const stat: ExomasteryStatDetailDTO = {
      id: nid(),
      kind: "numeric",
      chartPath: path,
      label: formatPathLabel(path),
      typicalDisplay: formatExomasteryValueForPath(path, mode),
      currentDisplay: missing ? "—" : formatExomasteryValueForPath(path, v!),
      isMissing: missing,
      diffPoints: null,
      diffRelativePercent: relDisp.pct,
      diffHuge: relDisp.huge,
      chevron: "none",
      compact: false,
      distribution,
    };
    if (CLIMATE_NUMERIC_TAILS.has(tail)) {
      atmosphereClimateStats.push(stat);
      continue;
    }
    stats.push(stat);
  }

  const makeCompRow = (
    kind: "material" | "atmosphere" | "solid",
    chartKey: string,
    el: string,
    rollup: ExomasteryNumericRollup,
    cur: { v: number | null; known: boolean },
  ): ExomasteryStatDetailDTO => {
    const mode = rollup.mode ?? rollup.mean;
    const missing = !cur.known;
    const curN = cur.known ? (cur.v ?? 0) : NaN;
    const dpp = cur.known && Number.isFinite(mode) ? Math.round(Math.abs(curN - mode) * 10) / 10 : null;
    let relVsTyp: number | null = null;
    let diffHuge = false;
    if (cur.known && Number.isFinite(mode) && Math.abs(mode) > 1e-6) {
      const raw = (Math.abs(curN - mode) / Math.abs(mode)) * 100;
      if (raw > 200) diffHuge = true;
      else relVsTyp = Math.round(raw * 10) / 10;
    }
    const curForComp = cur.known ? (cur.v ?? null) : null;
    return {
      id: nid(),
      kind,
      chartPath: chartKey,
      label: el,
      typicalDisplay: `${formatExomasteryNum(mode)}%`,
      currentDisplay: missing ? "—" : `${formatExomasteryNum(cur.v ?? 0)}%`,
      isMissing: missing,
      diffPoints: dpp,
      diffRelativePercent: relVsTyp,
      diffHuge,
      chevron: compositionChevron(curN, mode, missing),
      compact: true,
      distribution: buildCompositionDistributionDto(chartKey, rollup, curForComp, cur.known),
    };
  };

  const crustRows: ExomasteryStatDetailDTO[] = [];
  const crustScores: { label: string; score: number }[] = [];
  for (const [el, r] of Object.entries(profile.materials)) {
    const cur = crustMaterialValue(scan, rec, el);
    crustRows.push(makeCompRow("material", `material:${el}`, el, r, cur));
    if (cur.known) {
      crustScores.push({
        label: el,
        score: similarityToRollupComposition(cur.v ?? 0, r) * 100,
      });
    }
  }

  const atmoRows: ExomasteryStatDetailDTO[] = [];
  const atmoScores: { label: string; score: number }[] = [];
  for (const [el, r] of Object.entries(profile.atmosphereComposition)) {
    const cur = atmoGasValue(scan, rec, el);
    atmoRows.push(makeCompRow("atmosphere", `atmosphere:${el}`, el, r, cur));
    if (cur.known) {
      atmoScores.push({
        label: el,
        score: similarityToRollupComposition(cur.v ?? 0, r) * 100,
      });
    }
  }

  const solidRows: ExomasteryStatDetailDTO[] = [];
  const solidScores: { label: string; score: number }[] = [];
  for (const [el, r] of Object.entries(profile.solidComposition ?? {})) {
    const cur = solidValue(scan, rec, el);
    solidRows.push(makeCompRow("solid", `solid:${el}`, el, r, cur));
    if (cur.known) {
      solidScores.push({
        label: el,
        score: similarityToRollupComposition(cur.v ?? 0, r) * 100,
      });
    }
  }

  const profMatLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  for (const name of collectJournalMaterialElementNames(scan, rec)) {
    const low = name.toLowerCase();
    if (profMatLower.has(low)) continue;
    const cur = crustMaterialValue(scan, rec, name);
    if (!cur.known) continue;
    crustRows.push({
      id: nid(),
      kind: "material",
      chartPath: `material:journal-extra:${low}`,
      label: name,
      typicalDisplay: "—",
      currentDisplay: `${formatExomasteryNum(cur.v ?? 0)}%`,
      isMissing: false,
      diffPoints: null,
      diffRelativePercent: null,
      diffHuge: false,
      chevron: "none",
      compact: true,
    });
  }

  const profGasLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  for (const name of collectJournalAtmosphereGasNames(scan, rec)) {
    const low = name.toLowerCase();
    if (profGasLower.has(low)) continue;
    const cur = atmoGasValue(scan, rec, name);
    if (!cur.known) continue;
    atmoRows.push({
      id: nid(),
      kind: "atmosphere",
      chartPath: `atmosphere:journal-extra:${low}`,
      label: name,
      typicalDisplay: "—",
      currentDisplay: `${formatExomasteryNum(cur.v ?? 0)}%`,
      isMissing: false,
      diffPoints: null,
      diffRelativePercent: null,
      diffHuge: false,
      chevron: "none",
      compact: true,
    });
  }

  const profSolidLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));
  for (const key of collectJournalSolidKeys(scan, rec)) {
    if (profSolidLower.has(key.toLowerCase())) continue;
    const cur = solidValue(scan, rec, key);
    if (!cur.known) continue;
    solidRows.push({
      id: nid(),
      kind: "solid",
      chartPath: `solid:journal-extra:${key.toLowerCase()}`,
      label: key,
      typicalDisplay: "—",
      currentDisplay: cur.v != null && Number.isFinite(cur.v) ? `${formatExomasteryNum(cur.v)}%` : "—",
      isMissing: false,
      diffPoints: null,
      diffRelativePercent: null,
      diffHuge: false,
      chevron: "none",
      compact: true,
    });
  }

  const byCompDiff = (a: ExomasteryStatDetailDTO, b: ExomasteryStatDetailDTO) =>
    (a.diffPoints ?? 9999) - (b.diffPoints ?? 9999) || a.label.localeCompare(b.label);
  crustRows.sort(byCompDiff);
  atmoRows.sort(byCompDiff);
  solidRows.sort(byCompDiff);

  for (const [path, counts] of Object.entries(profile.categorical ?? {})) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    const modeVal = modeCategoricalLabel(counts);
    if (!modeVal) continue;
    const scanVal = valueForCategoricalPath(path, scan, rec, journalHost);
    const missing = !scanVal;
    const modeDisp = normalizeCategoricalValueForCompare(path, modeVal);
    const curDisp = scanVal ? normalizeCategoricalValueForCompare(path, scanVal) : "—";
    const sim = !missing && scanVal ? categoricalSimilarity(scanVal, modeVal, path) : 0;
    const closeness: "match" | "close" | "different" | undefined =
      !missing && scanVal ? (sim >= 1 ? "match" : sim >= 0.85 ? "close" : "different") : undefined;
    const mkAxis = classifyHostMkPath(path);
    let stellarProximitySteps: number | undefined;
    let stellarProximityAxis: ExomasteryStatDetailDTO["stellarProximityAxis"];
    if (!missing && scanVal && mkAxis) {
      const raw = computeMkAxisStepDistance(mkAxis, modeDisp, curDisp);
      if (raw != null) {
        stellarProximitySteps = Math.min(4, raw);
        stellarProximityAxis = mkAxis;
      }
    }
    stats.push({
      id: nid(),
      kind: "categorical",
      chartPath: path,
      label: formatPathLabel(path),
      typicalDisplay: modeDisp,
      currentDisplay: missing ? "—" : curDisp,
      isMissing: missing,
      diffPoints: null,
      diffRelativePercent: null,
      chevron: "none",
      compact: false,
      categoricalCloseness: closeness,
      ...(stellarProximitySteps != null ? { stellarProximitySteps, stellarProximityAxis } : {}),
    });
  }

  const supplementalMk = buildSupplementalHostMkRows(stats, profile, journalHost, nid);
  if (supplementalMk.length > 0) stats.unshift(...supplementalMk);

  const compositionGroups: ExomasteryCompositionGroupDTO[] = [];
  if (solidRows.length > 0 || crustRows.length > 0) {
    compositionGroups.push({
      id: "crust",
      title: "Crust & surface",
      summary: summarizeCompositionMatch([...solidScores, ...crustScores]),
      rows: [...solidRows, ...crustRows],
    });
  }
  if (atmoRows.length) {
    compositionGroups.push({
      id: "atmosphere",
      title: "Atmosphere composition (gases)",
      summary: summarizeCompositionMatch(atmoScores),
      rows: atmoRows,
    });
  }

  return {
    stats,
    compositionGroups,
    ...(atmosphereClimateStats.length > 0 ? { atmosphereClimateStats } : {}),
  };
}

/**
 * DSS / journal-only breakdown — same duplex/table shape as {@link buildExomasteryDetail},
 * “Typical (mode)” inactive (em dash). Climate block is temp + pressure + atmosphere gases; crust lists all journal materials & solids.
 */
export function buildBodyScanExomasteryDetail(
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
): ExomasteryDetailDTO {
  let idx = 0;
  const nid = () => `jr-${idx++}`;
  const row = (
    path: string,
    label: string,
    disp: string,
    missing: boolean,
    kind: ExomasteryStatDetailDTO["kind"] = "numeric",
    compact = false,
  ): ExomasteryStatDetailDTO => ({
    id: nid(),
    kind,
    chartPath: path,
    label,
    typicalDisplay: "—",
    currentDisplay: missing ? "—" : disp,
    isMissing: missing,
    diffPoints: null,
    diffRelativePercent: null,
    diffHuge: false,
    chevron: "none",
    compact,
  });

  const atmosphereClimateStats: ExomasteryStatDetailDTO[] = [];

  const temp = scan.SurfaceTemperature ?? rec?.surfaceTemperature;
  atmosphereClimateStats.push(
    row(
      "journal.climate.surface_temperature",
      "Surface temperature",
      temp != null ? `${temp.toFixed(2)} K` : "—",
      temp == null,
    ),
  );

  const press = scan.SurfacePressure ?? rec?.surfacePressure;
  const atm = press != null ? journalPressureToAtm(press) : null;
  atmosphereClimateStats.push(
    row(
      "journal.climate.surface_pressure",
      "Surface pressure",
      atm != null ? `${atm.toFixed(6)} atm` : "—",
      atm == null,
    ),
  );

  const rawGas = journalAtmosphereCompositionArray(scan, rec);
  if (rawGas) {
    for (const m of rawGas) {
      if (!m || typeof m !== "object") continue;
      const o = m as Record<string, unknown>;
      const name = String(o.Name ?? o.name ?? "").trim();
      const pct = journalPercentNumber(o.Percent ?? o.percent);
      if (!name || pct == null) continue;
      atmosphereClimateStats.push({
        ...row(
          `journal.climate.gas.${name.toLowerCase()}`,
          name,
          `${formatExomasteryNum(pct)}%`,
          false,
          "atmosphere",
          true,
        ),
      });
    }
  }

  const bodyTraitStats: ExomasteryStatDetailDTO[] = [];
  const rawG = scan.SurfaceGravity ?? rec?.surfaceGravity;
  const gEarth = rawG != null && Number.isFinite(rawG) ? journalSurfaceGravityToG(rawG) : null;
  bodyTraitStats.push(
    row(
      "journal.body.surface_gravity",
      "Gravity",
      gEarth != null ? `${gEarth.toFixed(3)} Earth g` : "—",
      gEarth == null,
    ),
  );

  const mass = scan.MassEM ?? rec?.massEM;
  bodyTraitStats.push(
    row(
      "journal.body.mass_em",
      "Earth masses",
      mass != null && Number.isFinite(mass) ? formatExomasteryNum(mass) : "—",
      mass == null || !Number.isFinite(mass),
    ),
  );

  const pClass = scan.PlanetClass ?? rec?.planetClass;
  bodyTraitStats.push(
    row("journal.body.planet_class", "Planet class", (pClass ?? "—").trim() || "—", !pClass?.trim()),
  );

  const atTyp = scan.AtmosphereType ?? rec?.atmosphereType ?? scan.Atmosphere ?? rec?.atmosphere;
  bodyTraitStats.push(
    row("journal.body.atmosphere_type", "Atmosphere type", (atTyp ?? "—").trim() || "—", !atTyp?.trim()),
  );

  const volc = scan.Volcanism ?? rec?.volcanism;
  bodyTraitStats.push(
    row("journal.body.volcanism", "Volcanism type", (volc ?? "—").trim() || "—", !volc?.trim()),
  );

  const bodyType = rec?.bodyType;
  bodyTraitStats.push(
    row("journal.body.body_type", "Type", (bodyType ?? "—").trim() || "—", !bodyType?.trim()),
  );

  const subCls = rec?.subclass;
  bodyTraitStats.push(
    row(
      "journal.body.subclass",
      "Sub type",
      subCls != null && Number.isFinite(subCls) ? String(subCls) : "—",
      subCls == null || !Number.isFinite(subCls),
    ),
  );

  const terra = scan.TerraformState ?? rec?.terraformState;
  bodyTraitStats.push(
    row("journal.body.terraform", "Terraform state", (terra ?? "—").trim() || "—", !terra?.trim()),
  );

  const rad = scan.radius ?? rec?.radius;
  bodyTraitStats.push(
    row(
      "journal.body.radius",
      "Radius",
      rad != null && Number.isFinite(rad) ? `${formatExomasteryNum(rad / 1000)} km` : "—",
      rad == null || !Number.isFinite(rad),
    ),
  );

  const surfaceTraitStats: ExomasteryStatDetailDTO[] = [];
  const tidal = scan.TidalLock ?? rec?.tidalLock;
  surfaceTraitStats.push(
    row(
      "journal.surface.tidal_lock",
      "Tidal lock",
      tidal === true ? "Yes" : tidal === false ? "No" : "—",
      tidal == null,
    ),
  );
  const foot = scan.WasFootfalled;
  if (foot !== undefined) {
    surfaceTraitStats.push(
      row("journal.surface.was_footfalled", "Surface footfall (scan flag)", foot ? "Yes" : "No", false),
    );
  }

  const orbitTraitStats: ExomasteryStatDetailDTO[] = [];
  const sma = scan.SemiMajorAxis ?? rec?.semiMajorAxis;
  orbitTraitStats.push(
    row(
      "journal.orbit.semi_major_axis",
      "Semi-major axis",
      sma != null && Number.isFinite(sma) ? `${formatExomasteryNum(sma / AU_METERS)} AU` : "—",
      sma == null || !Number.isFinite(sma),
    ),
  );
  const op = scan.OrbitalPeriod ?? rec?.orbitalPeriod;
  orbitTraitStats.push(
    row(
      "journal.orbit.orbital_period",
      "Orbital period",
      op != null && Number.isFinite(op) ? `${formatExomasteryNum(op / SECONDS_PER_DAY)} d` : "—",
      op == null || !Number.isFinite(op),
    ),
  );
  const ecc = scan.Eccentricity ?? rec?.eccentricity;
  orbitTraitStats.push(
    row(
      "journal.orbit.eccentricity",
      "Eccentricity",
      ecc != null && Number.isFinite(ecc) ? formatExomasteryNum(ecc) : "—",
      ecc == null || !Number.isFinite(ecc),
    ),
  );
  const inc = scan.OrbitalInclination ?? rec?.orbitalInclination;
  orbitTraitStats.push(
    row(
      "journal.orbit.inclination",
      "Orbital inclination",
      inc != null && Number.isFinite(inc) ? `${formatExomasteryNum(inc)} rad` : "—",
      inc == null || !Number.isFinite(inc),
    ),
  );
  const peri = scan.Periapsis ?? rec?.periapsis;
  orbitTraitStats.push(
    row(
      "journal.orbit.periapsis",
      "Periapsis",
      peri != null && Number.isFinite(peri) ? `${formatExomasteryNum(peri)} rad` : "—",
      peri == null || !Number.isFinite(peri),
    ),
  );
  const an = scan.AscendingNode ?? rec?.ascendingNode;
  orbitTraitStats.push(
    row(
      "journal.orbit.ascending_node",
      "Ascending node",
      an != null && Number.isFinite(an) ? `${formatExomasteryNum(an)} rad` : "—",
      an == null || !Number.isFinite(an),
    ),
  );
  const ma = scan.MeanAnomaly ?? rec?.meanAnomaly;
  orbitTraitStats.push(
    row(
      "journal.orbit.mean_anomaly",
      "Mean anomaly",
      ma != null && Number.isFinite(ma) ? `${formatExomasteryNum(ma)} rad` : "—",
      ma == null || !Number.isFinite(ma),
    ),
  );
  const rp = scan.RotationPeriod ?? rec?.rotationPeriod;
  orbitTraitStats.push(
    row(
      "journal.orbit.rotation_period",
      "Rotation period",
      rp != null && Number.isFinite(rp) ? `${formatExomasteryNum(rp / SECONDS_PER_DAY)} d` : "—",
      rp == null || !Number.isFinite(rp),
    ),
  );
  const ax = scan.AxialTilt ?? rec?.axialTilt;
  orbitTraitStats.push(
    row(
      "journal.orbit.axial_tilt",
      "Axial tilt",
      ax != null && Number.isFinite(ax) ? `${formatExomasteryNum(ax)} rad` : "—",
      ax == null || !Number.isFinite(ax),
    ),
  );
  const distLs = rec?.distanceFromArrivalLs;
  orbitTraitStats.push(
    row(
      "journal.orbit.distance_from_arrival",
      "Distance from arrival",
      distLs != null && Number.isFinite(distLs) ? `${formatExomasteryNum(distLs)} LS` : "—",
      distLs == null || !Number.isFinite(distLs),
    ),
  );

  const miscTraitStats: ExomasteryStatDetailDTO[] = [];
  miscTraitStats.push(
    row(
      "journal.misc.system_address",
      "System address",
      typeof scan.SystemAddress === "number" ? String(scan.SystemAddress) : "—",
      typeof scan.SystemAddress !== "number",
    ),
  );
  miscTraitStats.push(row("journal.misc.body_id", "Body ID", String(scan.BodyID), false));

  const matRows: ExomasteryStatDetailDTO[] = [];
  for (const name of collectJournalMaterialElementNames(scan, rec)) {
    const cur = crustMaterialValue(scan, rec, name);
    if (!cur.known) continue;
    matRows.push({
      ...row(
        `journal.crust.material.${name.toLowerCase()}`,
        name,
        `${formatExomasteryNum(cur.v ?? 0)}%`,
        false,
        "material",
        true,
      ),
    });
  }
  matRows.sort((a, b) => a.label.localeCompare(b.label));

  const solidJRows: ExomasteryStatDetailDTO[] = [];
  const comp = journalCompositionObject(scan, rec);
  if (comp) {
    for (const key of collectJournalSolidKeys(scan, rec)) {
      const rawV = comp[key];
      const v = typeof rawV === "number" && Number.isFinite(rawV) ? rawV : null;
      if (v == null) continue;
      const disp = journalSolidPercentFromRaw(key, v);
      solidJRows.push({
        ...row(
          `journal.crust.solid.${key.toLowerCase()}`,
          key,
          `${formatExomasteryNum(disp)}%`,
          false,
          "solid",
          true,
        ),
      });
    }
  }
  solidJRows.sort((a, b) => a.label.localeCompare(b.label));

  const crustCombined = [...solidJRows, ...matRows];
  const emptySummary: ExomasteryCompositionSummaryDTO = {
    overallMatchPercent: null,
    best: null,
    worst: null,
  };
  const compositionGroups: ExomasteryCompositionGroupDTO[] =
    crustCombined.length > 0
      ? [{ id: "crust", title: "Crust & surface", summary: emptySummary, rows: crustCombined }]
      : [];

  return {
    stats: [...bodyTraitStats, ...surfaceTraitStats, ...orbitTraitStats, ...miscTraitStats],
    compositionGroups,
    atmosphereClimateStats,
  };
}
