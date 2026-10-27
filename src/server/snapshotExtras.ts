/**
 * What the snapshot carries beyond the journal store: the notices, the NSP card, the neutron route being flown, the
 * FSD's health, jumponium, the bookmarks here and the commanders. Moved out of edexoBootstrap.ts (2026-10-27: the
 * file was ten lines from its size cap); unchanged.
 */
import type { AppSnapshot } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import type { createNoticesService } from "./notices.js";
import type { createNeutronLive } from "./neutronLive.js";
import type { createBookmarksService } from "./bookmarks.js";
import type { createCommanderWatch } from "./commanderWatch.js";
import { perfTime } from "./perf.js";
import { getProjectRoot } from "./paths.js";
import { nspOutlook } from "./nspOutlook.js";
import { regionForSystem } from "./regionMapData.js";
import { fsdWearEstimate, FSD_WARN } from "../shared/fsdWear.js";
import { jumponiumView } from "../shared/jumponium.js";

export interface SnapshotExtrasDeps {
  store: GameStateStore;
  notices: ReturnType<typeof createNoticesService>;
  neutronLive: ReturnType<typeof createNeutronLive>;
  shipHere: () => { name: string | null; pos: GameStateStore["commanderPos"] | null };
  bookmarks: ReturnType<typeof createBookmarksService>;
  commanderWatch: ReturnType<typeof createCommanderWatch>;
  mainStarTypeOf: (addr: number) => string | null;
}

export function addSnapshotExtras(
  snap: AppSnapshot,
  { store, notices, neutronLive, shipHere, bookmarks, commanderWatch, mainStarTypeOf }: SnapshotExtrasDeps,
): void {
  // Neither while the history replays: the boot screen covers both (plan 2.3, Opus 20).
  snap.notices = snap.journalBoot
    ? undefined
    : notices.snapshot(store.viewingSystemAddress ?? store.currentSystemAddress ?? null);
  {
    // The NSP card (2026-09-30): what he saw, what EDAstro has, else a guess from the neighbourhood.
    const addr = store.viewingSystemAddress ?? store.currentSystemAddress ?? null;
    snap.nspOutlook =
      addr == null || snap.journalBoot
        ? null
        : perfTime("snap.nspOutlook", () =>
            nspOutlook({
              systemAddress: addr,
              position: store.systemPositions.get(addr) ?? null,
              seen: store.nspSeen.get(addr) ?? [],
              region: (() => {
                const pos = store.systemPositions.get(addr);
                return pos
                  ? regionForSystem(getProjectRoot(), pos.x, pos.y, pos.z)
                  : (snap.currentRegion?.name ?? null);
              })(),
              starType: mainStarTypeOf(addr),
            }),
          );
  }
  snap.neutronLive = snap.journalBoot ? null : neutronLive.view(shipHere());
  {
    const w = fsdWearEstimate(store.fsdWear);
    snap.fsdHealth =
      snap.journalBoot || w.health == null
        ? null
        : {
            health: w.health,
            warn: w.health < FSD_WARN,
            boostsSince: w.boostsSince,
            estimate: w.boostsSince > 0 && w.wearIsDefault,
          };
  }
  snap.jumponium = snap.journalBoot ? null : jumponiumView(store.jumponium);
  snap.bookmarksHere = bookmarks.forSystem(
    store.viewingSystemAddress ?? store.currentSystemAddress ?? null,
    snap.viewingSystemName ?? store.currentSystem ?? null,
  );
  snap.commanders = commanderWatch.state();
}
