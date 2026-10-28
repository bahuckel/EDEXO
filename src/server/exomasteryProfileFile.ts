/*
  The feeder's exomastery profile on disk (split out of exomasteryProfile.ts unchanged): its types, where a species'
  profile file is (`species/<genus>/exomastery/*.json`, else a legacy `*_exomastery*.json` in the genus folder),
  loading and caching it, and the download name. exomasteryProfile.ts re-exports all of it and does the scoring.
*/
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SpeciesEntry } from "../shared/types.js";
import type { AtmosphereBands } from "../feeder/atmosphereBands.js";
import type { SpeciesHistograms } from "../shared/likelihoodBins.js";
import { getSpeciesDataDir } from "./paths.js";

/** One numeric/material rollup from feeder (mode = most common bucket after rounding). */
export interface ExomasteryNumericRollup {
  min: number;
  max: number;
  mean: number;
  count?: number;
  mode?: number;
  modeCount?: number;
}

export interface ExomasteryProfileV1 {
  formatVersion: number;
  speciesLabel?: string;
  genus?: string;
  /**
   * Feeder profile JSON: number of distinct EDSM bodies merged into this profile (`bodies.length`).
   * When absent, UI falls back to {@link maxExomasteryProfileSampleCount}.
   */
  sampleCount?: number;
  /**
   * C3 provenance: the hash of the bodies that produced these numbers, and the three counts that
   * show how many raw CSV rows became how many observations. Absent on profiles built before it was
   * recorded. See `feeder/profileProvenance.ts`.
   */
  provenance?: {
    inputHash: string;
    csvRows: number;
    occurrences: number;
    bodies: number;
  };
  /**
   * False on profiles built from part of a species' range (the EDDN year's bodies, 1.2.20): no observed-temperature
   * envelope from them. Their min / max are where it was seen in a year, not its range — Roseum Anemone's 107 bodies
   * stopped at 219 K and a confirmed find at 202.9 K was demoted (2026-10-19, 12,000 Spansh DSS bodies).
   */
  observedEnvelope?: boolean;
  /**
   * True: for the species guide's charts only — the app does not load it at all, so its predictions stay as they
   * were without it (1.2.20: Sinuous Tubers Blatteum's profile moved a confirmed find on hold-out D under the 1 %
   * floor). {@link loadExomasteryProfile} answers null.
   */
  siteOnly?: boolean;
  numerics: Record<string, ExomasteryNumericRollup>;
  materials: Record<string, ExomasteryNumericRollup>;
  atmosphereComposition: Record<string, ExomasteryNumericRollup>;
  solidComposition: Record<string, ExomasteryNumericRollup>;
  /**
   * Histogram of habitat labels. For host-star matching vs the commander’s journal, use path keys like
   * `exo.host_star_spectral_primary` with single-letter / `TTS` tokens (feeder should aggregate from `starSummaries`).
   */
  categorical?: Record<string, Record<string, number>>;
  /**
   * Temperature and pressure percentiles per atmosphere type, written by the feeder.
   *
   * Absent on profiles built before the bands existed; every scoring path falls back to the pooled
   * rollups when a cell is missing or too thin to describe a range.
   */
  atmosphereBands?: AtmosphereBands;
  /**
   * Per-parameter histograms on the globally shared bin edges, written by `feeder run` / `rebuild`.
   *
   * The rollups above say where a species sits on average; these say how often it sits *here*, which
   * is the difference between a similarity score and a likelihood. Read by the ranking model
   * (`speciesLikelihood.ts`); absent on profiles built before it existed.
   */
  histograms?: SpeciesHistograms;
  /**
   * Chart bins over this species' own range, written by the same feeder pass (B7).
   *
   * Separate from {@link histograms} because the two answer different questions: the model needs one
   * ruler for every species, and a picture of one species needs the resolution its own range allows.
   */
  displayHistograms?: Record<string, { min: number; max: number; counts: number[] }>;
  /**
   * Per-parameter determinism against the pooled background, written by `feeder run` / `rebuild`.
   *
   * 1 means every observation of this species shares one value for the parameter; 0 means it is
   * spread exactly like the galaxy; negative means it is spread *wider*, so the parameter provably
   * does not constrain it.
   *
   * **Measured, published, and not consumed by the scorer** — see `parameterImportance.ts`. All 53
   * parameters are now measured on one scale and the ordering is right: surface temperature 0.575,
   * atmosphere type 0.443, radius 0.406, mass 0.404, pressure 0.375, gravity 0.361 at the top —
   * four of the owner's five main factors, unprompted — and argument of periapsis at 0.022, where
   * the estimator it replaces scored it 0.802.
   *
   * Feeding it into this scorer still measures worse ranking (top-1 106 → 81 of 405), and the reason
   * is a distinction worth stating: determinism is how much a parameter constrains **a species**,
   * while ranking needs how much it separates **the candidates on this body**. After gating on
   * temperature and atmosphere, the parameters with the highest determinism have the least variance
   * left among the survivors, so raising their weight flattens the score rather than sharpening it.
   * The quantity ranking wants is the mutual information between a parameter and species identity,
   * which is a different measurement and belongs to the ranking model itself.
   */
  parameterImportance?: Record<string, number>;
}

const profileCache = new Map<string, ExomasteryProfileV1 | null | undefined>();
/**
 * {@link resolveExomasteryExportBasename} per species. It reads and parses every profile in the genus folder to
 * find the one whose label matches, and the foot catalog asks it for every species row of every snapshot: 22 %
 * of a first-view snapshot's time went here (code review, 2026-10-14). Cleared with the profiles.
 */
const exportBasenameCache = new Map<string, string | null>();

/** Drop parsed profiles so the next load re-reads `*_exomastery*.json` from disk (e.g. after feeder export). */
export function clearExomasteryProfileCache(): void {
  profileCache.clear();
  exportBasenameCache.clear();
}

export function speciesSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Filename candidates aligned with feeder exports + genus JSON `id` slugs. */
export function exomasteryProfileCandidateFilenames(entry: SpeciesEntry): string[] {
  const names = new Set<string>();
  const add = (raw: string) => {
    const s = speciesSlug(raw);
    if (!s) return;
    names.add(`${s}_exomastery.json`);
    names.add(`${s}_exomastery_profile.json`);
  };
  add(entry.displayName);
  add(`${entry.genus} ${entry.displayName}`.trim());
  add(entry.id.replace(/__+/g, "_"));
  return [...names];
}

function profileLooksUsable(j: Record<string, unknown>): boolean {
  const nonempty = (o: unknown) => Boolean(o && typeof o === "object" && Object.keys(o as object).length > 0);
  return (
    nonempty(j.numerics) ||
    nonempty(j.materials) ||
    nonempty(j.atmosphereComposition) ||
    nonempty(j.solidComposition) ||
    nonempty(j.categorical) ||
    // A profile carrying only histograms is still one the ranking model can use.
    nonempty(j.histograms)
  );
}

/** Shared matching for `exomastery/*.json` (profile rollups or EDSM row exports). */
export function exomasterySpeciesLabelMatchesEntry(
  entry: SpeciesEntry,
  speciesLabel: string | undefined,
  basenameNoExt: string,
): boolean {
  return profileSpeciesLabelMatchesEntry(speciesLabel, entry, basenameNoExt);
}

function profileSpeciesLabelMatchesEntry(
  speciesLabel: string | undefined,
  entry: SpeciesEntry,
  basenameNoExt: string,
): boolean {
  const fromJson = typeof speciesLabel === "string" ? speciesLabel.trim() : "";
  if (fromJson) {
    const n = speciesSlug(fromJson);
    if (n === speciesSlug(entry.displayName)) return true;
    if (n === speciesSlug(`${entry.genus} ${entry.displayName}`.trim())) return true;
    if (fromJson.toLowerCase() === entry.displayName.trim().toLowerCase()) return true;
    if (fromJson.toLowerCase() === `${entry.genus} ${entry.displayName}`.trim().toLowerCase()) return true;
  }
  const fn = speciesSlug(basenameNoExt);
  if (fn && fn === speciesSlug(entry.displayName)) return true;
  if (fn && fn === speciesSlug(`${entry.genus} ${entry.displayName}`.trim())) return true;
  if (fn && fn === speciesSlug(entry.id.replace(/__+/g, "_"))) return true;
  return false;
}

/**
 * Feeder JSON stores crust/air/solid rollups under `body.materials.*`, `body.atmosphereComposition.*`,
 * `body.solidComposition.*` inside `numerics`. Move them into the composition maps so
 * {@link buildExomasteryDetail} / {@link crustMaterialValue} compare journal % to profile mode.
 */
function hoistFeederCompositionRollups(prof: ExomasteryProfileV1): void {
  const num = prof.numerics;
  if (!num || typeof num !== "object") return;
  const del: string[] = [];
  for (const path of Object.keys(num)) {
    const m = /^body\.materials\.(.+)$/i.exec(path);
    if (m?.[1]) {
      prof.materials[m[1]] = num[path]!;
      del.push(path);
      continue;
    }
    const a = /^body\.atmosphereComposition\.(.+)$/i.exec(path);
    if (a?.[1]) {
      prof.atmosphereComposition[a[1]] = num[path]!;
      del.push(path);
      continue;
    }
    const s = /^body\.solidComposition\.(.+)$/i.exec(path);
    if (s?.[1]) {
      prof.solidComposition ??= {};
      prof.solidComposition[s[1]] = num[path]!;
      del.push(path);
    }
  }
  for (const k of del) delete num[k];
}

function normalizeLoadedProfile(j: Record<string, unknown>): ExomasteryProfileV1 {
  const prof = j as unknown as ExomasteryProfileV1;
  prof.numerics ??= {};
  prof.materials ??= {};
  prof.atmosphereComposition ??= {};
  prof.solidComposition ??= {};
  const sc = j.sampleCount;
  if (typeof sc === "number" && Number.isFinite(sc) && sc >= 0) prof.sampleCount = Math.trunc(sc);
  const pv = j.provenance as Record<string, unknown> | undefined;
  if (pv && typeof pv.inputHash === "string" && pv.inputHash) {
    const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
    prof.provenance = {
      inputHash: pv.inputHash,
      csvRows: n(pv.csvRows),
      occurrences: n(pv.occurrences),
      bodies: n(pv.bodies),
    };
  }
  hoistFeederCompositionRollups(prof);
  return prof;
}

/**
 * Feeder exports under `data/species/<genusDir>/exomastery/*.json`, matched by `speciesLabel` (or filename slug).
 */
function tryLoadExomasteryFromGenusSubdir(base: string, entry: SpeciesEntry): ExomasteryProfileV1 | null {
  const sub = join(base, "exomastery");
  if (!existsSync(sub) || !statSync(sub).isDirectory()) return null;
  let files: string[];
  try {
    files = readdirSync(sub);
  } catch {
    return null;
  }
  const jsonFiles = files.filter((f) => f.toLowerCase().endsWith(".json")).sort((a, b) => a.localeCompare(b));
  for (const f of jsonFiles) {
    const p = join(sub, f);
    try {
      const raw = readFileSync(p, "utf8");
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (!profileLooksUsable(j)) continue;
      const label = typeof j.speciesLabel === "string" ? j.speciesLabel : undefined;
      const stem = f.replace(/\.json$/i, "");
      if (!profileSpeciesLabelMatchesEntry(label, entry, stem)) continue;
      return normalizeLoadedProfile(j);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Absolute path to the feeder profile JSON that {@link loadExomasteryProfile} would read for this entry, if any.
 */
export function resolveExomasteryProfileJsonPath(projectRoot: string, entry: SpeciesEntry): string | null {
  const base = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);
  const sub = join(base, "exomastery");
  if (existsSync(sub) && statSync(sub).isDirectory()) {
    let files: string[];
    try {
      files = readdirSync(sub);
    } catch {
      files = [];
    }
    const jsonFiles = files
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));
    for (const f of jsonFiles) {
      const p = join(sub, f);
      try {
        const raw = readFileSync(p, "utf8");
        const j = JSON.parse(raw) as Record<string, unknown>;
        if (!profileLooksUsable(j)) continue;
        const label = typeof j.speciesLabel === "string" ? j.speciesLabel : undefined;
        const stem = f.replace(/\.json$/i, "");
        if (!profileSpeciesLabelMatchesEntry(label, entry, stem)) continue;
        return p;
      } catch {
        continue;
      }
    }
  }
  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    const p = join(base, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Max `count` observed on numeric rollups (0 = none / unknown). */
export function maxExomasteryProfileSampleCount(profile: ExomasteryProfileV1): number {
  let m = 0;
  const bump = (r: ExomasteryNumericRollup) => {
    if (typeof r.count === "number" && r.count > m) m = r.count;
  };
  for (const r of Object.values(profile.numerics)) bump(r);
  for (const r of Object.values(profile.materials)) bump(r);
  for (const r of Object.values(profile.atmosphereComposition)) bump(r);
  for (const r of Object.values(profile.solidComposition ?? {})) bump(r);
  return m;
}

/** Distinct feeder bodies merged into profile — prefers feeder JSON `sampleCount`, else rollup max `count`. */
export function feederProfileBodyCount(profile: ExomasteryProfileV1): number {
  const n = profile.sampleCount;
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) return Math.trunc(n);
  return maxExomasteryProfileSampleCount(profile);
}

/** Optional profile JSON: `species/<genus>/exomastery/*.json` first, then legacy `*_exomastery*.json` in genus root. */
export function loadExomasteryProfile(projectRoot: string, entry: SpeciesEntry): ExomasteryProfileV1 | null {
  // Keyed by root as well as species: the app only ever has one project root, but the feeder status
  // builder takes one as a parameter, and a cache that ignores it would answer for the wrong tree.
  const cacheKey = `${projectRoot}::${entry.genusDataDir}::${entry.id}`;
  if (profileCache.has(cacheKey)) {
    const c = profileCache.get(cacheKey);
    return c === undefined ? null : c;
  }
  const base = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);

  const fromSub = tryLoadExomasteryFromGenusSubdir(base, entry);
  if (fromSub) {
    // A guide-only profile is no profile to the app (see siteOnly).
    const use = fromSub.siteOnly === true ? undefined : fromSub;
    profileCache.set(cacheKey, use);
    return use ?? null;
  }

  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    const p = join(base, name);
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf8");
      const j = JSON.parse(raw) as Record<string, unknown>;
      if (profileLooksUsable(j)) {
        const prof = normalizeLoadedProfile(j);
        const use = prof.siteOnly === true ? undefined : prof;
        profileCache.set(cacheKey, use);
        return use ?? null;
      }
    } catch {
      /* try next filename */
    }
  }
  profileCache.set(cacheKey, null);
  return null;
}

export function hasExomasteryProfileFile(projectRoot: string, entry: SpeciesEntry): boolean {
  return loadExomasteryProfile(projectRoot, entry) != null;
}

/** Basename for download: JSON under `exomastery/` (matched by speciesLabel) or legacy genus-root file. */
export function resolveExomasteryExportBasename(projectRoot: string, entry: SpeciesEntry): string | null {
  const cacheKey = `${projectRoot}::${entry.genusDataDir}::${entry.id}`;
  const hit = exportBasenameCache.get(cacheKey);
  if (hit !== undefined) return hit;
  const found = resolveExomasteryExportBasenameUncached(projectRoot, entry);
  exportBasenameCache.set(cacheKey, found);
  return found;
}

function resolveExomasteryExportBasenameUncached(projectRoot: string, entry: SpeciesEntry): string | null {
  const base = join(getSpeciesDataDir(projectRoot), entry.genusDataDir);
  const sub = join(base, "exomastery");
  if (existsSync(sub)) {
    try {
      const cand = readdirSync(sub)
        .filter((f) => f.toLowerCase().endsWith(".json"))
        .sort((a, b) => a.localeCompare(b));
      for (const f of cand) {
        try {
          const j = JSON.parse(readFileSync(join(sub, f), "utf8")) as Record<string, unknown>;
          const label = typeof j.speciesLabel === "string" ? j.speciesLabel : undefined;
          const stem = f.replace(/\.json$/i, "");
          if (profileSpeciesLabelMatchesEntry(label, entry, stem)) return f;
        } catch {
          continue;
        }
      }
    } catch {
      /* */
    }
  }
  for (const name of exomasteryProfileCandidateFilenames(entry)) {
    if (existsSync(join(base, name))) return name;
  }
  return null;
}
