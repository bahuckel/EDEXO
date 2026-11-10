import { clearAchievementsCache } from "./achievements.js";
import { clearBodyTypePriorCache } from "./bodyTypePrior.js";
import { clearChanceCalibrationCache } from "./chanceCalibration.js";
import { clearChanceRecalibrationCache } from "./chanceRecalibration.js";
import { clearCodexFirstCache } from "./codexFirst.js";
import { clearCodexMapCache } from "./codexMap.js";
import { clearCodexVariantCountsCache } from "./codexVariantCounts.js";
import { clearColourStarNeverCache } from "./colourStarNever.js";
import { clearEddnTemperatureRangeCache } from "./eddnTemperatureRange.js";
import { clearEddsnColourVariantsCache } from "./eddsnColourVariants.js";
import { clearExomasteryProfileCache } from "./exomasteryProfile.js";
import { clearExpeditionCache } from "./expeditionService.js";
import { clearFieldGuideCache } from "./fieldGuide.js";
import { clearFirmTemperatureEdgesCache } from "./firmTemperatureEdges.js";
import {
  clearFootCatalogSpeciesDb,
  clearFootScannedCatalogCache,
  flushFootScannedCatalog,
} from "./footScannedCatalog.js";
import { clearGalaxyRegionNamesCache } from "./galaxyBodyScan.js";
import { resetGenusBodySplitCache } from "./genusBodySplit.js";
import { clearGenusCooccurrenceCache } from "./genusCooccurrenceTable.js";
import { clearGeologyCache } from "./geology.js";
import { clearGenusPriorCache } from "./genusPrior.js";
import { clearLikelihoodDataCache } from "./likelihoodData.js";
import { clearMeasuredExclusionsCache } from "./measuredExclusions.js";
import { clearObservedEnvelopeCache } from "./observedEnvelope.js";
import { clearPhotoCreditsCache } from "./photoCredits.js";
import { clearRegionMapCache } from "./regionMapData.js";
import { clearRegionSpeciesCache } from "./regionSpeciesData.js";
import { clearEncyclopediaPayloadCache } from "./snapshot.js";
import { clearSpatialCatalogueCache } from "./spatialCatalogue.js";
import { dropSpeciesComputed } from "./speciesDb.js";
import { clearHostStarObservationsCache } from "./speciesHostStarObservations.js";
import { clearSpeciesPhotoCache } from "./speciesPhotos.js";
import { clearPlanetClassObservationsCache } from "./speciesPlanetClassObservations.js";
import { clearSpeciesProvenanceCache } from "./speciesProvenance.js";
import { clearSpeciesRarityCache } from "./speciesRarityData.js";
import { clearSpeciesSplitCache } from "./speciesSplit.js";
import { clearGenusPhotosFolderCache } from "./speciesTreeLoader.js";
import { clearStarlightRangesCache } from "./starlightRanges.js";

/**
 * Everything read from the species tree and the exomastery profiles, forgotten in one place.
 *
 * Three reload paths (the species-tree watcher, "Refresh exomastery", and the Fix dialog's clear)
 * each kept their own list and the lists had drifted: after a refresh the host-star and planet-class
 * observations — built from the profiles — kept answering from the old ones until a restart, and the
 * watcher path dropped the foot catalog's unwritten rows (code review A8, 2026-09-27). The catalog is
 * written first now, so clearing its cache cannot lose a find.
 *
 * Its own module (audit 2026-10-22), so the list is easy to audit: a missed entry here has happened four
 * times (A8, B10, review 2026-11-10 §5). tests/dataCacheReload.test.ts fails on a module under src/server that reads
 * data/exomastery, data/species or data/codex into a module-level cache whose clearer is not called here.
 */
export function reloadSpeciesDerivedCaches(): void {
  flushFootScannedCatalog();
  clearFootScannedCatalogCache();
  clearFootCatalogSpeciesDb();
  clearExomasteryProfileCache();
  clearEncyclopediaPayloadCache();
  clearFieldGuideCache();
  clearExpeditionCache();
  clearSpeciesPhotoCache();
  clearGenusPhotosFolderCache();
  clearEddsnColourVariantsCache();
  clearPhotoCreditsCache();
  clearRegionSpeciesCache();
  clearHostStarObservationsCache();
  clearColourStarNeverCache();
  clearEddnTemperatureRangeCache();
  clearMeasuredExclusionsCache();
  clearPlanetClassObservationsCache();
  clearStarlightRangesCache();
  clearObservedEnvelopeCache();
  clearBodyTypePriorCache();
  // The fitted which-of-the-genus tables (data/exomastery/species-split.json, speciesSplit.ts).
  clearSpeciesSplitCache();
  clearAchievementsCache();
  // Code review B10 (2026-10-14): the genus chances and limits, the Brain Tree / Tubers split and the
  // ranking's edges and prevalence were kept until a restart.
  clearGenusPriorCache();
  resetGenusBodySplitCache();
  clearLikelihoodDataCache();
  // Review 2026-11-07: the firm EDDN edges, the chance calibration and recalibration, the nebula / Guardian catalogue
  // and the region map kept the old files until a restart.
  clearFirmTemperatureEdgesCache();
  clearChanceCalibrationCache();
  clearChanceRecalibrationCache();
  clearSpatialCatalogueCache();
  clearRegionMapCache();
  // Review 2026-11-10 §5: genus co-occurrence, colour rarity and region sites, the codex region tables, geology,
  // the region names of the galaxy scan, sector provenance and rarity were kept until a restart.
  clearGenusCooccurrenceCache();
  clearCodexVariantCountsCache();
  clearCodexFirstCache();
  clearCodexMapCache();
  clearGeologyCache();
  clearGalaxyRegionNamesCache();
  clearSpeciesProvenanceCache();
  clearSpeciesRarityCache();
  // Last: the per-body predictions ranked with the old tables go too (the refresh path does not reload the tree).
  dropSpeciesComputed();
}
