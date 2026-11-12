/*
  The settings switches that write the settings file after them, and the collection focus (split out of
  edexoBootstrap.ts, plan 2026-11-10 Phase 7.1).
*/
import type { GameStateStore } from "./gameState.js";
import type { HttpServerOptions } from "./httpServerTypes.js";
import { mergeCollectionFocus } from "../shared/collectionFocus.js";
import {
  clearCollectionFocusCache,
  loadCollectionFocusConfig,
  saveCollectionFocusConfig,
  type CollectionFocusConfig,
} from "./collectionFocus.js";

type PrefsKeys =
  | "setHudPrefs"
  | "getCollectionFocus"
  | "setCollectionFocus"
  | "setIncludeBacterium"
  | "setIncludeExplorationScanData"
  | "setPranavAntalBonus"
  | "setSellAtFleetCarrier"
  | "setFeederEnabled"
  | "setFleetCarrierIsOwn"
  | "setFootTravelOdometer"
  | "setPhotoStamp"
  | "setExoMapTierThresholds";

/** A settings setter that writes the settings file after it (audit 2026-10-22: ten copies of the pair). */
export function persistedWith(persistUserPreferences: () => void) {
  return <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A): void => {
      fn(...a);
      persistUserPreferences();
    };
}

export function prefsOptions({
  store,
  persistUserPreferences,
  push,
}: {
  store: GameStateStore;
  persistUserPreferences: () => void;
  push: () => void;
}): Pick<HttpServerOptions, PrefsKeys> {
  const persisted = persistedWith(persistUserPreferences);
  return {
    setHudPrefs: persisted((raw) => store.setHudPrefs(raw)),
    getCollectionFocus: () => loadCollectionFocusConfig(),
    /*
      Clamped on the way in and the stored config handed straight back, so a figure the server
      refused shows up in the panel as the figure that will actually be used.

      The cache is cleared because the marker is memoised for a few seconds and a threshold the
      commander has just moved should take effect on the next body, not when a timer says so.
    */
    setCollectionFocus: (raw) => {
      const next = mergeCollectionFocus(
        loadCollectionFocusConfig(),
        (raw ?? {}) as Partial<CollectionFocusConfig>,
      );
      saveCollectionFocusConfig(next);
      clearCollectionFocusCache();
      push();
      return next;
    },
    setIncludeBacterium: persisted((v) => store.setIncludeBacteriumInSearch(v)),
    setIncludeExplorationScanData: persisted((v) => store.setIncludeExplorationScanDataInDataValue(v)),
    setPranavAntalBonus: persisted((v) => store.setPranavAntalBonus(v)),
    setSellAtFleetCarrier: persisted((v) => store.setSellAtFleetCarrier(v)),
    setFeederEnabled: persisted((v) => store.setFeederEnabled(v)),
    setFleetCarrierIsOwn: persisted((v) => store.setFleetCarrierIsOwn(v)),
    setFootTravelOdometer: persisted((v) => store.setFootTravelOdometerEnabled(v)),
    setPhotoStamp: persisted((p) => store.setPhotoStamp(p)),
    setExoMapTierThresholds: persisted((plus, pp) => store.setExoMapTierThresholds(plus, pp)),
  };
}
