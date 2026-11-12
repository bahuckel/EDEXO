/*
  One `Status.json` tick for the running app (split out of edexoBootstrap.ts, plan 2026-11-10 Phase 7.1): the live
  route, the radar's fix, the targeted body, the fuel, and a push only when one of them moved. The timer and the
  watch that call it are statusPoller.ts.
*/
import path from "node:path";
import { readFileSync } from "node:fs";
import type { ExoLiveDTO } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import type { createJournalSideFiles } from "./journalSideFiles.js";
import { parseStatusJson, statusDestination, statusFootFix, statusFuel } from "./footTravelStatus.js";
import { applyLiveFix } from "./liveFix.js";

type SideFiles = ReturnType<typeof createJournalSideFiles>;

export type StatusTickDeps = {
  store: GameStateStore;
  getJournalDir: () => string;
  /** Status.json and NavRoute.json are the game's commander's: while that is another commander, not ours (1.3.1). */
  gameIsAnotherCommander: () => boolean;
  applyNavRoute: SideFiles["applyNavRoute"];
  readLiveNavRouteWaypoints: SideFiles["readLiveNavRouteWaypoints"];
  broadcastExoLive: (live: ExoLiveDTO) => void;
  buildExoLive: () => ExoLiveDTO;
  push: () => void;
  readStatus?: (file: string) => string;
};

export function createStatusTick(d: StatusTickDeps): () => void {
  const { store, push } = d;
  const readStatus = d.readStatus ?? ((file: string) => readFileSync(file, "utf8"));
  let lastJumpKey: string | null = null;
  const jumpChangedNow = (): boolean => {
    const jt = store.nextJumpTarget();
    const key = jt ? `${jt.source}|${jt.systemAddress}|${jt.starSystem}|${jt.arrived ? 1 : 0}` : "";
    if (key === lastJumpKey) return false;
    lastJumpKey = key;
    return true;
  };
  return () => {
    if (d.gameIsAnotherCommander()) return;
    const navChanged = d.applyNavRoute(d.readLiveNavRouteWaypoints());
    const jumpChanged = jumpChangedNow();
    const statusPath = path.join(d.getJournalDir(), "Status.json");
    let raw: string;
    try {
      raw = readStatus(statusPath);
    } catch (e) {
      /*
        A locked or momentarily missing file is not news either — same reasoning as a torn read
        below. Elite holds the file briefly while rewriting it, and at a 100 ms poll plus a
        watch on every write we land in that window often. Reporting "no position" each time
        blanked the radar and re-armed the sample cue.
      */
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return;
      store.exoOrganicLastFix = null;
      const hadDest = store.statusDestination != null;
      store.statusDestination = null;
      store.applyLiveShipFuel(null, null);
      const footHudEmpty = store.footTravelOdometerEnabled && store.footTravelOdometerTracking;
      if (footHudEmpty || store.exoOrganicTracker || navChanged || hadDest || jumpChanged) push();
      return;
    }
    /*
      A read that could not be parsed is skipped outright, not reported as "off the surface".

      Those are two different facts and they used to share one `null`. Elite rewrites this file
      in place, so reading it mid-write yields a truncated line — constantly, now that the read
      happens on every write as well as every 100 ms. Each one cleared `exoOrganicLastFix`,
      which blanked the radar for a frame and, worse, sent `nearestSampleMeetsMin` through
      `true -> null -> true`: an edge, so the HUD played the "far enough now" cue again. The
      owner heard it on every radar update instead of once per boundary crossing.
    */
    const status = parseStatusJson(raw);
    if (!status) return;
    const read = statusFootFix(status);
    const fix = read.kind === "fix" ? read.fix : null;
    // The odometer's sample, the nose's pitch from the flight path, and the radar's fix (null: off the surface).
    applyLiveFix(store, fix);
    // The targeted body: the HUD's candidate list, and a one-shot jump to its Body tab. Pushed
    // only when it actually changes — see `applyStatusDestination`.
    const destChanged = store.applyStatusDestination(statusDestination(status));
    const fuel = statusFuel(status);
    const fuelChanged = store.applyLiveShipFuel(
      fuel != null ? fuel.fuelMain : null,
      fuel != null ? fuel.fuelReserve : null,
      fuel?.cargo ?? null,
    );
    /*
      The radar goes out on every tick, at the commander's chosen poll rate, whether or not
      anything else changed. It is the one thing on the HUD that has to move smoothly, and the
      coalesced `push()` below cannot carry it: that window exists because a full snapshot is
      expensive to build, and the radar's two fields are not.

      Identical frames are dropped inside the broadcaster, so standing still costs nothing.
    */
    if (store.exoOrganicTracker || store.overlayTouchdownBodyKey) d.broadcastExoLive(d.buildExoLive());

    const footHud = store.footTravelOdometerEnabled && store.footTravelOdometerTracking;
    if (footHud || store.exoOrganicTracker || fuelChanged || navChanged || destChanged || jumpChanged) push();
  };
}
