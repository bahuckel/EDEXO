/*
  The launcher's update, What's new and Copy diagnostics routes (split out of edexoBootstrap.ts, plan 2026-11-10
  Phase 7.1).
*/
import path from "node:path";
import os from "node:os";
import type { GameStateStore } from "./gameState.js";
import type { HttpServerOptions } from "./httpServerTypes.js";
import type { createUpdateChecker } from "./updateCheck.js";
import type { createAppUpdater } from "./appUpdater.js";
import type { createWhatsNew } from "./whatsNew.js";
import type { createStatusReader } from "./appStatus.js";
import type { createJournalPipeline } from "./journalPipeline.js";
import type { GamePresence } from "./gamePresence.js";
import { currentReleaseForm } from "./updateCheck.js";
import { APP_VERSION } from "./appVersion.js";
import { buildDiagnosticsText, loggedLines, serverMemory } from "./diagnostics.js";
import { galaxyMemoryState } from "./galaxyMemory.js";
import { loadPersistedJournalDir } from "./journalDirPreference.js";
import { getCachedSpeciesDatabase } from "./snapshot.js";
import { openUrlInBrowser } from "./openUrl.js";

type UpdateDiagnosticsKeys =
  | "getUpdateInfo"
  | "startUpdateDownload"
  | "getWhatsNew"
  | "getDiagnostics"
  | "markWhatsNewSeen"
  | "openUpdatePage";

export function updateDiagnosticsOptions({
  store,
  projectRoot,
  getStatus,
  journal,
  gamePresence,
  updateChecker,
  appUpdater,
  whatsNew,
}: {
  store: GameStateStore;
  projectRoot: string;
  getStatus: ReturnType<typeof createStatusReader>;
  journal: Pick<ReturnType<typeof createJournalPipeline>, "lastBoot">;
  gamePresence: Pick<GamePresence, "running">;
  updateChecker: ReturnType<typeof createUpdateChecker>;
  appUpdater: ReturnType<typeof createAppUpdater>;
  whatsNew: ReturnType<typeof createWhatsNew>;
}): Pick<HttpServerOptions, UpdateDiagnosticsKeys> {
  return {
    getUpdateInfo: async (force) => ({
      ...(await updateChecker.check(force)),
      download: appUpdater.status(),
    }),
    startUpdateDownload: () => {
      void appUpdater.start();
      return appUpdater.status();
    },
    getWhatsNew: (any) => whatsNew.get(any),
    getDiagnostics: async () => {
      const st = getStatus();
      const upd = await updateChecker.check(false);
      const dl = appUpdater.status();
      return buildDiagnosticsText({
        now: new Date(),
        version: APP_VERSION,
        form:
          process.env.EDEXO_ELECTRON_PACKAGED === "1"
            ? currentReleaseForm()
            : "pkg" in process
              ? "console build"
              : "source",
        electron: process.versions.electron ?? null,
        node: process.versions.node,
        platform: process.platform,
        osRelease: os.release(),
        arch: process.arch,
        memGb: Math.round(os.totalmem() / 2 ** 30),
        journalDir: st.journalDir,
        journalDirOk: st.journalDirConfiguredOk,
        journalDirChosen: loadPersistedJournalDir(projectRoot) !== null,
        journalFiles: st.journalFileCount,
        currentJournal: st.journalPath ? path.basename(st.journalPath) : null,
        historyPreset: st.journalHistoryPreset ?? "all",
        lastEventIso: st.lastJournalEventIso,
        boot: journal.lastBoot(),
        booting: st.journalBoot ? `${st.journalBoot.phase} ${st.journalBoot.percent} %` : null,
        mode: st.mode,
        port: st.port,
        bindHost: st.bindHost,
        lanAccess: st.lanAccess,
        gameRunning: process.env.EDEXO_ELECTRON === "1" ? gamePresence.running() : null,
        uploads: {
          edsmFetch: store.edsmAutoFetchEnabled,
          edsmUpload: store.edsmUploadEnabled,
          canonn: store.canonnUploadEnabled,
          eddn: store.eddnUploadEnabled,
        },
        update: {
          latest: upd.latest,
          checkedAt: upd.checkedAt,
          error: upd.error,
          download: dl.supported ? `${dl.state}${dl.error ? ` (${dl.error})` : ""}` : null,
        },
        speciesCount: getCachedSpeciesDatabase().species.length,
        speciesDataWarnings: st.speciesDataWarnings?.length ?? 0,
        commander: store.commanderName,
        log: loggedLines(),
        memory: serverMemory(galaxyMemoryState()),
      });
    },
    markWhatsNewSeen: () => whatsNew.seen(),
    openUpdatePage: () => {
      const url = updateChecker.updatePageUrl();
      if (!url) return { ok: false, error: "No newer version known." };
      openUrlInBrowser(url);
      return { ok: true };
    },
  };
}
