/*
  What one live journal line does in the running app (split out of edexoBootstrap.ts, plan 2026-11-10 Phase 7.1):
  Colonize and the other followers, the notices, the store, the uploaders, the route followers, the radar, the
  session log. The historical replay never comes here (journalPipeline.ts applies it to the store directly).
*/
import type { JournalLine } from "../shared/types.js";
import type { GameStateStore } from "./gameState.js";
import type { JournalLineAt } from "./journalWatcher.js";
import type { NoticesContext, NoticesService } from "./notices.js";
import type { GggResearch } from "./gggResearch.js";
import type { AchievementWatch } from "./achievementNotices.js";
import type { NeutronLive, Here } from "./neutronLive.js";
import type { NeutronReplanner } from "./neutronReplan.js";
import type { NeutronFuelWatch } from "./neutronFuelWatch.js";
import type { BoxelRun } from "./boxelRun.js";
import type { SavedBoxelsService } from "./savedBoxels.js";
import type { SessionLog } from "./sessionLog.js";
import type { createJournalSideFiles } from "./journalSideFiles.js";
import { activeCommander } from "./activeCommander.js";
import { isOtherCommandersJournal } from "./journalCommanders.js";
import { emitLiveJournalLine } from "./journalTap.js";
import { achievementNoticeText } from "./achievementNotices.js";
import { journalLineFix } from "./liveFix.js";
import { ingestExoOrganicJournalLine } from "./exoOrganicTracker.js";
import { getCachedPrices, getCachedSpeciesDatabase } from "./snapshot.js";

type Offer = { offer(line: JournalLine): void };
type OnEvent = { onJournalLine(event: string | undefined): void };
type SideFiles = ReturnType<typeof createJournalSideFiles>;

export type LiveJournalLineDeps = {
  store: GameStateStore;
  projectRoot: string;
  notices: NoticesService;
  noticesContext: NoticesContext;
  gggResearch: GggResearch;
  achievementWatch: AchievementWatch;
  maybeAutoFetchOnArrival: (line: JournalLine) => void;
  canonnUploader: Offer;
  eddnUploader: Offer;
  liveSideFiles: SideFiles["liveSideFiles"];
  applyNavRoute: SideFiles["applyNavRoute"];
  carrierFollow: { tick(): void };
  neutronLive: NeutronLive;
  neutronReplanner: NeutronReplanner;
  neutronFuelWatch: NeutronFuelWatch;
  shipHere: () => Here;
  boxelRun: BoxelRun;
  savedBoxels: SavedBoxelsService;
  sessionLog: SessionLog;
  unknownExobio: Offer;
  backupService: OnEvent;
  gamePresence: OnEvent;
  push: () => void;
};

export function createLiveJournalLine(d: LiveJournalLineDeps): (line: JournalLine, at: JournalLineAt) => void {
  const { store, notices, noticesContext, neutronLive } = d;
  return (line: JournalLine, at: JournalLineAt) => {
    /*
      Another commander's session (1.3.1): the lists leave other commanders' files out, but a file the game has just
      started names nobody until its Commander line, and the tail may be following it then. Nothing from it is
      this run's, not even for Colonize.
    */
    const cmdr = activeCommander();
    if (cmdr && isOtherCommandersJournal(at.path, cmdr.fid)) return;
    // Colonize and any other follower first (journalTap.ts): a failure below must not cost them the line.
    emitLiveJournalLine(line, at);
    try {
      // Before the store applies it: a body the store already has is a re-scan, not a find.
      notices.observe(line, noticesContext);
      d.gggResearch.observe(line);
      // Read before apply() closes the run: the tracker files an Analyse under the run's body too.
      const ownLine = store.ownBodyForAnalyse(line);
      d.achievementWatch.prime();
      store.applyLive(line);
      for (const a of d.achievementWatch.check()) {
        if (
          notices.announceAchievement(
            { id: a.id, step: a.step, ...achievementNoticeText(a) },
            String(line.timestamp ?? new Date().toISOString()),
          )
        )
          d.push();
      }
      // Live lines only. The historical replay calls store.apply directly, which is what keeps a
      // first run from asking EDSM about every system the commander has ever visited.
      d.maybeAutoFetchOnArrival(line);
      d.canonnUploader.offer(line);
      d.eddnUploader.offer(line);
      const side = d.liveSideFiles();
      d.applyNavRoute(side.route);
      d.carrierFollow.tick();
      if (line.event === "FSDJump" && neutronLive.follows() !== "carrier") {
        // A neutron route being flown owns the clipboard; else the boxel run or the saved boxel's next.
        const flying = neutronLive.active();
        const onStop = neutronLive.onJump(d.shipHere()) != null;
        if (flying && !onStop && neutronLive.offRoute(d.shipHere())) void d.neutronReplanner.replan();
        if (!flying) d.boxelRun.onJump();
        // A run can end on a jump (its last system flown): the HUD line says so.
        if (store.boxelCopied) store.boxelCopied.run = d.savedBoxels.runId() != null;
      }
      d.neutronFuelWatch.onLine(line);
      const footFix = journalLineFix(store, side.status);
      ingestExoOrganicJournalLine(store, ownLine, footFix, d.projectRoot, getCachedSpeciesDatabase());
      d.sessionLog.record(line, store, getCachedPrices());
      d.unknownExobio.offer(line);
      const event = typeof line.event === "string" ? line.event : undefined;
      d.backupService.onJournalLine(event);
      d.gamePresence.onJournalLine(event);
      d.push();
    } catch (e) {
      console.error("Journal live line failed (skipped line):", e);
    }
  };
}
