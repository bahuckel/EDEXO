/*
  The read-only species pages: Encyclopedia, field guide, region rarity, feeder status, card verdicts and the
  prediction quality table (split out of edexoBootstrap.ts, plan 2026-11-10 Phase 7.1).
*/
import type { GameStateStore } from "./gameState.js";
import type { HttpServerOptions } from "./httpServerTypes.js";
import {
  buildEncyclopediaPayload,
  findSpeciesEntryForEncyclopedia,
  getCachedSpeciesDatabase,
} from "./snapshot.js";
import { cardVerdictsFor } from "./cardVerdicts.js";
import { predictionRecords } from "./predictionAuditLog.js";
import { predictionQuality } from "./predictionQuality.js";
import { buildFieldGuide } from "./fieldGuide.js";
import { regionalRarity } from "./speciesRarityData.js";
import { buildFeederStatus } from "./feederStatus.js";
import { buildEncyclopediaExomasteryPlanetsPayload } from "./exomasteryEdsmEncyclopedia.js";

type SpeciesInfoKeys =
  | "getCardVerdicts"
  | "getPredictionQuality"
  | "getEncyclopedia"
  | "getFieldGuide"
  | "getEncyclopediaRegion"
  | "getFeederStatus"
  | "getEncyclopediaExomastery";

export function speciesInfoOptions({
  store,
  projectRoot,
}: {
  store: GameStateStore;
  projectRoot: string;
}): Pick<HttpServerOptions, SpeciesInfoKeys> {
  return {
    getCardVerdicts: (scan, est, ctx) => {
      const out: Record<string, ReturnType<typeof cardVerdictsFor>> = {};
      for (const e of getCachedSpeciesDatabase().species) out[e.id] = cardVerdictsFor(e, scan, est, ctx);
      return out;
    },
    getPredictionQuality: () => {
      const byId = new Map(getCachedSpeciesDatabase().species.map((e) => [e.id, e]));
      return predictionQuality(predictionRecords(), (id) => {
        const e = byId.get(id);
        return e ? { name: e.displayName, genus: e.genus ?? "" } : null;
      });
    },
    getEncyclopedia: buildEncyclopediaPayload,
    getFieldGuide: () => buildFieldGuide(projectRoot, getCachedSpeciesDatabase()),
    getEncyclopediaRegion: (name) =>
      Object.fromEntries(
        getCachedSpeciesDatabase().species.map(
          (e) => [e.id, regionalRarity(projectRoot, name, e.id)] as const,
        ),
      ),
    getFeederStatus: () => buildFeederStatus(projectRoot, getCachedSpeciesDatabase()),
    getEncyclopediaExomastery: (genusDir, speciesEntryId, focusBodyKey) => {
      const entry = findSpeciesEntryForEncyclopedia(genusDir, speciesEntryId);
      if (!entry) return null;
      const fb = focusBodyKey?.trim() || store.uiSelectedBodyKey || null;
      return buildEncyclopediaExomasteryPlanetsPayload(projectRoot, entry, store, fb);
    },
  };
}
