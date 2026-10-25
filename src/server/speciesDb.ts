/*
  The species database and the price list as the server holds them (split out of snapshot.ts, discuss item 30,
  1.3.1): loaded from the tree with each species' rarity tier and starlight range, reloaded on request, the
  generation counter the per-body caches are keyed on, and the Encyclopedia's rows built once per database.
*/
import type { EncyclopediaSpeciesRowDTO, SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import { getProjectRoot } from "./paths.js";
import { bumpMatchCacheEpoch } from "./matchCacheEpoch.js";
import { clearStarlightRangesCache, starlightRangeFor } from "./starlightRanges.js";
import { resolveSpeciesPhoto } from "./speciesPhotos.js";
import { loadSpeciesDatabaseFromTree } from "./speciesTreeLoader.js";
import { loadPriceList, lookupPrice, type PriceIndex } from "./priceList.js";
import { countEdsmPlanetRows } from "./exomasteryEdsmEncyclopedia.js";
import { clearFootCatalogSpeciesDb } from "./footScannedCatalog.js";
import {
  feederProfileBodyCount,
  loadExomasteryProfile,
  maxExomasteryProfileSampleCount,
} from "./exomasteryProfile.js";
import { clearExoOrganicGenusMinDistCache, setExoOrganicSpeciesDb } from "./exoOrganicTracker.js";
import { clearSpeciesRarityCache, speciesRarity } from "./speciesRarityData.js";

/**
 * Bumped whenever the species database or price list is reloaded, so per-body caches keyed on it
 * drop automatically. See {@link computeBody}.
 */
let speciesDataGeneration = 0;

let cachedDb: SpeciesDatabase = { species: [] };
let cachedPrices: PriceIndex = new Map();

/** Called after every reload (snapshot.ts drops its per-body cache). */
const reloadListeners = new Set<() => void>();
export function onSpeciesReload(listener: () => void): void {
  reloadListeners.add(listener);
}

/** Which load of the species database and price list this is: per-body caches are keyed on it. */
export function speciesGeneration(): number {
  return speciesDataGeneration;
}

/** Tag every species with its rarity tier (EDSM codex + extras + own new sightings) — the DNA badge reads it. */
export function tagRarity(db: SpeciesDatabase, root: string): void {
  for (const e of db.species) {
    const r = speciesRarity(root, e.id);
    if (r) e.rarity = r;
    else delete e.rarity;
  }
}

/** A fresh database starts from the files again (Refresh exomastery re-reads them). */
function withRarity(db: SpeciesDatabase, root: string): SpeciesDatabase {
  clearSpeciesRarityCache();
  tagRarity(db, root);
  // The starlight ranges ride along for the Encyclopedia card; the gate reads them server-side.
  clearStarlightRangesCache();
  for (const e of db.species) {
    const s = starlightRangeFor(e.id);
    if (s) e.starlight = { gate: s.gate, lo: s.lo, hi: s.hi, n: s.n };
  }
  return db;
}

export function loadSpeciesDatabase(): SpeciesDatabase {
  const root = getProjectRoot();
  clearExoOrganicGenusMinDistCache();
  cachedDb = withRarity(loadSpeciesDatabaseFromTree(root), root);
  setExoOrganicSpeciesDb(cachedDb);
  // The foot catalog keeps its own copy of the tree; a reload has to reach it too.
  clearFootCatalogSpeciesDb();
  speciesDataGeneration += 1;
  // The per-body caches built on the old tree (snapshot.ts's computeBody) are dropped.
  for (const l of reloadListeners) l();
  bumpMatchCacheEpoch();
  cachedPrices = loadPriceList(root);
  if (!cachedDb.species.length) {
    console.warn("ED Exo Compare — no species loaded; add data/species/<genus>/… (*_new.json or *.json)");
  }
  return cachedDb;
}

export function getCachedPrices(): PriceIndex {
  return cachedPrices;
}

export function getCachedSpeciesDatabase(): SpeciesDatabase {
  return cachedDb;
}

export function getCachedPriceIndex(): PriceIndex {
  return cachedPrices;
}

/*
  The Encyclopedia's rows, built once per species database (UI review P5, 2026-09-29). Building them
  re-read and re-parsed every species' sample files (`countEdsmPlanetRows`, ~220 ms) on every open of
  the Encyclopedia; the files only change when the feeder or a photo refresh reloads the species
  caches, which clears this one too (edexoBootstrap `reloadSpeciesDerivedCaches`).
*/
let encyclopediaCache: { db: SpeciesDatabase; rows: EncyclopediaSpeciesRowDTO[] } | null = null;

export function clearEncyclopediaPayloadCache(): void {
  encyclopediaCache = null;
}

export function buildEncyclopediaPayload(): EncyclopediaSpeciesRowDTO[] {
  const root = getProjectRoot();
  if (!cachedDb.species.length) {
    cachedDb = withRarity(loadSpeciesDatabaseFromTree(root), root);
    setExoOrganicSpeciesDb(cachedDb);
  }
  if (encyclopediaCache?.db === cachedDb) return encyclopediaCache.rows;
  const rows = buildEncyclopediaRows(root);
  encyclopediaCache = { db: cachedDb, rows };
  return rows;
}

function buildEncyclopediaRows(root: string): EncyclopediaSpeciesRowDTO[] {
  return cachedDb.species.map((entry) => {
    const { photoUrl, photoNote, photoUrls, photoVariants, photoCreditByUrl } = resolveSpeciesPhoto(
      entry,
      root,
    );
    const exomasteryEdsmSampleCount = countEdsmPlanetRows(root, entry);
    const exomasteryProfile = loadExomasteryProfile(root, entry);
    const exomasteryProfileFilePresent = exomasteryProfile != null;
    const profileMaxN = exomasteryProfile ? maxExomasteryProfileSampleCount(exomasteryProfile) : 0;
    const exomasteryEncyclopediaAvailable = exomasteryProfileFilePresent || exomasteryEdsmSampleCount >= 1;
    const exomasteryDataInsufficient =
      exomasteryEncyclopediaAvailable &&
      ((exomasteryProfileFilePresent && profileMaxN === 1) ||
        (!exomasteryProfileFilePresent && exomasteryEdsmSampleCount === 1) ||
        (exomasteryProfileFilePresent && profileMaxN === 0 && exomasteryEdsmSampleCount === 1));
    const exomasteryFeederBodyCount = exomasteryProfile
      ? feederProfileBodyCount(exomasteryProfile)
      : exomasteryEdsmSampleCount;
    return {
      entry,
      priceCredits: lookupPrice(cachedPrices, entry.displayName, entry.id),
      photoUrl,
      photoNote,
      photoUrls,
      ...(photoVariants.length ? { photoVariants } : {}),
      ...(photoCreditByUrl ? { photoCreditByUrl } : {}),
      exomasteryEdsmSampleCount,
      exomasteryFeederBodyCount,
      exomasteryProfileFilePresent,
      exomasteryEncyclopediaAvailable,
      exomasteryDataInsufficient,
    };
  });
}

/** Resolve a species row for Encyclopedia HTTP APIs (validated genus folder name). */
export function findSpeciesEntryForEncyclopedia(
  genusDataDir: string,
  speciesEntryId: string,
): SpeciesEntry | null {
  if (!genusDataDir || genusDataDir.includes("..") || /[/\\]/.test(genusDataDir)) return null;
  if (!speciesEntryId) return null;
  if (!cachedDb.species.length) {
    cachedDb = loadSpeciesDatabaseFromTree(getProjectRoot());
    setExoOrganicSpeciesDb(cachedDb);
  }
  return cachedDb.species.find((e) => e.genusDataDir === genusDataDir && e.id === speciesEntryId) ?? null;
}
