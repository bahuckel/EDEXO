/*
  The per-colour habitat profiles (plan-1.4.0 §6.1; owner 2026-11-24: "wire them", both on the card and in the chance,
  the chance only if the EDDN year loses nothing): data/species/<genus>/exomastery/colours/<speciesId>@<colour>.json,
  built from every sighting of that colour (docs/perf/install_colour_profiles_140.py). A species' colours sit on the
  same histogram edges as the species, so a colour's profile scores and draws exactly as the species' does.

  Used for a body when the app predicts exactly one colour for the species there (its table or materials, else the
  stars by their light) and that colour's profile holds at least COLOUR_PROFILE_MIN_SAMPLES bodies; otherwise, and
  for every species without colours, the species profile as before.
*/
import { join } from "node:path";
import type { PlanetScan, SpeciesEntry, SpeciesMatchContext } from "../shared/types.js";
import { candidateMorphColorLabelByLight } from "../shared/candidateSpawnHints.js";
import { getSpeciesDataDir } from "./paths.js";
import {
  loadExomasteryProfile,
  readExomasteryProfileFile,
  type ExomasteryProfileV1,
} from "./exomasteryProfileFile.js";

/** A colour profile on fewer bodies than this is too thin to stand in for its species. */
export const COLOUR_PROFILE_MIN_SAMPLES = 100;

/**
 * Whether the chance scores with the colour's profile (the card always shows it). Off: on the EDDN year it lost 22 FSS
 * and 12 DSS true rows and 84 / 48 first places against the species profiles (run `colour` vs `shost`, 2026-11-24,
 * docs/colour-profiles-24112026.md), and the owner's condition was that the chance loses nothing.
 */
export const COLOUR_PROFILES_IN_CHANCE = false;

/**
 * The colour predicted for a species on this body: its own table or materials first, then the stars by their light on
 * the body, brightest first — a star whose class has no colour row hands over to the next, and with none left it is
 * "(unknown)", never a guessed class (owner, 2026-09-28). "" for a species without colours.
 */
export function predictedColourFor(entry: SpeciesEntry, ctx: SpeciesMatchContext | null, scan: PlanetScan | null): string {
  const stars = ctx?.colourStarTypes?.length ? ctx.colourStarTypes : [ctx?.colourStarType ?? ctx?.parentStarType];
  return candidateMorphColorLabelByLight(entry, stars, scan?.materials);
}

const cache = new Map<string, ExomasteryProfileV1 | null>();

export function clearColourProfileCache(): void {
  cache.clear();
}

/** One colour's profile of a species (`colour` as the app labels it, any case), or null when there is none or too few. */
export function colourProfile(root: string, entry: SpeciesEntry, colour: string): ExomasteryProfileV1 | null {
  const c = colour.trim().toLowerCase();
  if (!/^[a-z]+$/.test(c)) return null;
  const key = `${root}::${entry.id}@${c}`;
  if (cache.has(key)) return cache.get(key)!;
  const prof = readExomasteryProfileFile(join(getSpeciesDataDir(root), entry.genusDataDir, "exomastery", "colours", `${entry.id}@${c}.json`));
  let use: ExomasteryProfileV1 | null = null;
  if (prof && (prof.sampleCount ?? 0) >= COLOUR_PROFILE_MIN_SAMPLES) {
    // How much each parameter constrains is the species' measurement (display only); the colours do not carry it.
    const species = loadExomasteryProfile(root, entry);
    use = species?.parameterImportance && !prof.parameterImportance ? { ...prof, parameterImportance: species.parameterImportance } : prof;
  }
  cache.set(key, use);
  return use;
}

/** The profile for this species on this body — its predicted colour's when there is one to use — and that colour. */
export function profileForBody(
  root: string,
  entry: SpeciesEntry,
  ctx: SpeciesMatchContext | null | undefined,
  scan: PlanetScan | null | undefined,
): { profile: ExomasteryProfileV1 | null; colour: string | null } {
  const label = ctx || scan ? predictedColourFor(entry, ctx ?? null, scan ?? null) : "";
  const own = label ? colourProfile(root, entry, label) : null;
  return own ? { profile: own, colour: label } : { profile: loadExomasteryProfile(root, entry), colour: null };
}
