/*
  The species tree and price list on disk (split out of edexoBootstrap.ts, discuss item 30, 1.3.1): a change
  reloads the species database and its derived caches once per burst, and the watch follows the species folder
  when a portable or species-data-dir.json move points it elsewhere.
*/
import path from "node:path";
import { existsSync, watchFile, unwatchFile, watch } from "node:fs";
import { loadSpeciesDatabase } from "./snapshot.js";
import { getSpeciesDataDir, reapplySpeciesDataDirDiscoveryFromDisk } from "./paths.js";
import { reloadSpeciesDerivedCaches } from "./speciesCacheReload.js";

export function createSpeciesDataWatcher({ projectRoot, push }: { projectRoot: string; push: () => void }) {
  let speciesDataWatchRoot = getSpeciesDataDir(projectRoot);
  const priceListPath = path.join(projectRoot, "data", "price-list.json");

  /**
   * The recursive fs.watch on data/species fires once per touched file — boot alone reloaded the
   * species database ~110 times, each pass re-parsing all 19 genus JSON files and forcing a push.
   * Coalesce bursts into one reload.
   */
  const SPECIES_RELOAD_DEBOUNCE_MS = 300;
  let speciesReloadTimer: ReturnType<typeof setTimeout> | null = null;
  const onSpeciesTreeOrPricesChange = () => {
    if (speciesReloadTimer) clearTimeout(speciesReloadTimer);
    speciesReloadTimer = setTimeout(() => {
      speciesReloadTimer = null;
      reloadSpeciesDerivedCaches();
      loadSpeciesDatabase();
      push();
    }, SPECIES_RELOAD_DEBOUNCE_MS);
  };

  let speciesFsWatcher: ReturnType<typeof watch> | null = null;
  let speciesPollFallback = false;

  /** Re-scan portable / species-data-dir.json, then move the species tree watcher if the dir changed. */
  function retargetSpeciesDataWatcherIfNeeded(): void {
    reapplySpeciesDataDirDiscoveryFromDisk();
    const next = getSpeciesDataDir(projectRoot);
    if (next === speciesDataWatchRoot) return;
    speciesFsWatcher?.close();
    speciesFsWatcher = null;
    if (speciesPollFallback) {
      try {
        unwatchFile(speciesDataWatchRoot, onSpeciesTreeOrPricesChange);
      } catch {
        /* ignore */
      }
      speciesPollFallback = false;
    }
    speciesDataWatchRoot = next;
    try {
      speciesFsWatcher = watch(speciesDataWatchRoot, { recursive: true }, onSpeciesTreeOrPricesChange);
    } catch {
      watchFile(speciesDataWatchRoot, { interval: 1500 }, onSpeciesTreeOrPricesChange);
      speciesPollFallback = true;
    }
  }

  return {
    start(): void {
      try {
        speciesFsWatcher = watch(speciesDataWatchRoot, { recursive: true }, onSpeciesTreeOrPricesChange);
      } catch {
        watchFile(speciesDataWatchRoot, { interval: 1500 }, onSpeciesTreeOrPricesChange);
        speciesPollFallback = true;
      }

      if (existsSync(priceListPath)) {
        watchFile(priceListPath, { interval: 800 }, onSpeciesTreeOrPricesChange);
      }
    },
    retarget: retargetSpeciesDataWatcherIfNeeded,
    stop(): void {
      speciesFsWatcher?.close();
      if (speciesPollFallback) unwatchFile(speciesDataWatchRoot, onSpeciesTreeOrPricesChange);
      if (existsSync(priceListPath)) unwatchFile(priceListPath, onSpeciesTreeOrPricesChange);
    },
  };
}
