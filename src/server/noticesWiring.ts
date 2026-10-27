/**
 * The green gas giants' sources, the Notable card's options and the notices' view of the journal store. Moved out of
 * edexoBootstrap.ts (2026-10-27: the file was ten lines from its size cap); the wiring is unchanged.
 */
import type { GameStateStore } from "./gameState.js";
import type { NoticesContext } from "./notices.js";
import type { createNoticesService } from "./notices.js";
import { greenGiantForRecord, type createGreenGiantMarks, type GreenGiantSources } from "./greenGiants.js";
import { setNotableOptionsProvider } from "./notableOptions.js";
import { BODY_FEATURES } from "../shared/bodyFeatures.js";
import { fullJumpRange } from "../shared/jumpRange.js";
import { queryPoi } from "./edastroPoi.js";
import { queryCarriers } from "./edastroCarriers.js";
import { edastroGreenFor, nearbyNsp, nspK10Systems } from "./edastroNsp.js";
import { galacticRecords } from "./galacticRecords.js";
import { mainStarRecord } from "../shared/mainStar.js";

export function createNoticesWiring({
  store,
  notices,
  greenMarks,
}: {
  store: GameStateStore;
  notices: ReturnType<typeof createNoticesService>;
  greenMarks: ReturnType<typeof createGreenGiantMarks>;
}) {
  const bodiesInSystem = function* (addr: number) {
    yield* store.liveScansInSystem(addr);
    yield* store.soldScansInSystem(addr);
  };
  const greenExtras = { k10FromEdastro: nspK10Systems, edastroGreenFor, bodiesInSystem, marks: greenMarks };
  const greenSources = (): GreenGiantSources => ({
    ...greenExtras,
    greenCodexBodies: store.greenCodexBodies,
    k10Systems: store.k10Systems,
  });
  const scanOf = (k: string) => store.explorationScans.get(k) ?? store.soldExplorationScans.get(k) ?? null;
  /** The arrival star's type (distance 0), else the lowest-numbered star scanned: the phenomena model's main star. */
  const mainStarTypeOf = (addr: number): string | null =>
    mainStarRecord([...store.liveScansInSystem(addr), ...store.soldScansInSystem(addr)])?.starType ?? null;
  // The Notable card: green gas giants always (they are notable like an Earth-like), features as chosen.
  setNotableOptionsProvider(() => {
    const on = notices.prefs().features;
    return {
      green: greenExtras,
      features: new Set(BODY_FEATURES.filter((f) => on[f.key]).map((f) => f.key)),
    };
  });
  const noticesContext: NoticesContext = {
    isKnownBody: (k) => store.explorationScans.has(k) || store.soldExplorationScans.has(k),
    allScans: function* () {
      yield* store.explorationScans.values();
      yield* store.soldExplorationScans.values();
    },
    currentSystem: () => ({ name: store.currentSystem ?? "", address: store.currentSystemAddress ?? null }),
    loadoutJumpLy: () => store.loadoutMaxJumpRangeLy,
    fullJumpLy: () => fullJumpRange(store.jumpRange),
    // Both read the commander's own EDAstro downloads; with none fetched they find nothing.
    nearbyPois: (origin, radiusLy, groups) =>
      queryPoi({ origin, groups, limit: 50 })
        .filter((r) => r.distanceLy != null && r.distanceLy <= radiusLy)
        .map((r) => ({
          key: r.key,
          name: r.name,
          system: r.system,
          typeLabel: r.typeLabel,
          distanceLy: r.distanceLy!,
        })),
    nearbyCarriers: (origin, radiusLy) =>
      queryCarriers({ origin, limit: 100 })
        .filter((r) => r.distanceLy != null && r.distanceLy <= radiusLy)
        .map((r) => ({
          callsign: r.callsign,
          name: r.name,
          system: r.system,
          systemAddress: r.systemAddress,
          distanceLy: r.distanceLy!,
          lastSeenDays: r.lastSeenDays,
          services: r.services,
        })),
    nearbyNsps: (origin, radiusLy) => nearbyNsp(origin, radiusLy),
    galacticRecord: (key) => galacticRecords().get(key) ?? null,
    greenGiant: (rec) => greenGiantForRecord(rec, greenSources()),
    scanOf,
    rawStock: () => store.jumponium.raw,
  };
  return { greenExtras, greenSources, scanOf, mainStarTypeOf, noticesContext };
}
