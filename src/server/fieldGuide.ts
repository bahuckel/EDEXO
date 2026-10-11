/**
 * The Encyclopedia's field guide, built from this install's own files (see `shared/fieldGuide.ts`).
 *
 * Built once per species database and kept: 22 genus files and ~120 profiles are ~150 ms to read.
 * The bands and within-genus shares (plan 1.8) come from `data/exomastery/species-bands.json`.
 * Cleared with the other species-derived caches (edexoBootstrap `reloadSpeciesDerivedCaches`), so a
 * feeder refresh shows up the next time the Encyclopedia opens.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildGuideGenus, guideBands, type FieldGuideDTO, type GuideBands } from "../shared/fieldGuide.js";
import type { SpeciesDatabase } from "../shared/types.js";
import { loadExomasteryProfile } from "./exomasteryProfile.js";

let cache: { db: SpeciesDatabase; guide: FieldGuideDTO } | null = null;

export function clearFieldGuideCache(): void {
  cache = null;
}

/** The bands file, read once per build; a missing or broken file leaves every card on its charts alone. */
function bandsReader(projectRoot: string): (id: string) => GuideBands | null {
  let doc: { species?: Record<string, unknown>; atmoLabels?: Record<string, string> } | null = null;
  try {
    doc = JSON.parse(readFileSync(join(projectRoot, "data", "exomastery", "species-bands.json"), "utf8"));
  } catch {
    return () => null;
  }
  const species = doc?.species ?? {};
  const labels = doc?.atmoLabels ?? {};
  return (id) => guideBands(species[id], labels);
}

export function buildFieldGuide(projectRoot: string, db: SpeciesDatabase): FieldGuideDTO {
  if (cache?.db === db) return cache.guide;
  const byId = new Map(db.species.map((e) => [e.id, e]));
  const bandsFor = bandsReader(projectRoot);
  const dirs = [...new Set(db.species.map((e) => e.genusDataDir))].sort();
  const genera = [];
  for (const dir of dirs) {
    const file = join(projectRoot, "data", "species", dir, `${dir}_new.json`);
    if (!existsSync(file)) continue;
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    genera.push(
      buildGuideGenus(dir, json, (id) => {
        const entry = byId.get(id);
        return entry ? loadExomasteryProfile(projectRoot, entry) : null;
      }, bandsFor),
    );
  }
  const guide = { genera };
  cache = { db, guide };
  return guide;
}
