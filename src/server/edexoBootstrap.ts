import { flushNavRouteLog, navRouteLog } from "./navRouteLog.js";
import { enablePredictionAudit, flushPredictionAudit } from "./predictionAuditLog.js";
import { flushSurfaceMarks } from "./surfaceMarksFile.js";
import { startEddnLedgerWatch } from "./eddnLedger.js";
import path from "node:path";
import { achievementDetail, achievementExists, achievementsList } from "./achievements.js";
import { createAchievementWatch } from "./achievementNotices.js";
import {
  buildCodexExport,
  buildExomasteryExport,
  clearSharedExomasteryCache,
  commanderIdHash,
  exportFileName,
  ownCodexBackupKeys,
} from "./sharedExomastery.js";
import { ownFootEntriesWithBackups } from "./footScannedCatalog.js";
import { existsSync, statSync } from "node:fs";
import type { AppSnapshot, ExoLiveDTO, JournalLine, UiCommand } from "../shared/types.js";
import { journalHistoryCutoffUtcMs } from "../shared/journalHistoryPreset.js";
import { openUrlInBrowser, openLauncherShell, openLocalFile } from "./openUrl.js";
import { GameStateStore } from "./gameState.js";
import {
  readJournalFull,
  listJournalFilesChronological,
  type JournalListFilterOpts,
} from "./journalWatcher.js";
import { stopColonizeService } from "./colonize/colonizeService";
import { onColonizeHudChange } from "./colonize/hudSummary";
import { scanJournalsForStatistics } from "./statisticsScan.js";
import { createHttpServer, getLanIPv4s } from "./httpServer.js";
import { appViewUrl } from "./appViews.js";
import { describeUserDataMigration, migrateLegacyUserData } from "./userDataMigration.js";
import { resolveLanAccess } from "./launcherPrefs.js";
import { isLoopbackHostName, lanUrlWithKey, loadOrCreateLanKey } from "./lanAuth.js";
import { applyPendingRestore } from "./backup.js";
import { createBackupService } from "./backupService.js";
import { APP_USER_AGENT, APP_VERSION } from "./appVersion.js";
import {
  buildEncyclopediaPayload,
  buildSnapshot,
  getCachedSpeciesDatabase,
  setCodexFirstLowChanceKept,
  loadSpeciesDatabase,
  getCachedPrices,
} from "./snapshot.js";
import { writeExoDataAlertFixFiles } from "./exoDataAlertFix.js";
import { createGamePresence } from "./gamePresence.js";
import { buildFieldGuide } from "./fieldGuide.js";
import { buildDiscoveries } from "./discoveries.js";
import { flushFootScannedCatalog } from "./footScannedCatalog.js";
import {
  getProjectRoot,
  resolveCommanderDataDir,
  resolveLanKeyPath,
  resolveUserSettingsJsonPath,
  resolveExoOutlierLogPath,
  USER_SETTINGS_FILENAME,
} from "./paths.js";
import { guarded } from "./guarded.js";
import {
  persistJournalDirPreference,
  resolveInitialJournalDir,
} from "./journalDirPreference.js";
import {
  buildExoMinimapDto,
  buildExoOrganicOverlayDto,
  pressClearMarksHere,
  restoreOrganicSessionFromJournal,
} from "./exoOrganicTracker.js";
import { perfTime, startPerfReporter } from "./perf.js";
import { flushPendingOrganicSampleSession } from "./organicSampleSessionFile.js";
import { searchEdsmSystemsByName } from "./edsmSystemHydration.js";
import { searchSpanshSystemsByName } from "./spanshSystemHydration.js";
import { SessionLog } from "./sessionLog.js";
import {
  backlogMap,
  firstDiscoveryBacklogSliced,
  firstDiscoveryBacklogWithDistance,
} from "./firstDiscoveryBacklog.js";
import { galaxySpeciesCatalogue, galaxyValueSearch } from "./galaxyValueSearch.js";
import { galaxyBodyScan, galaxyRegions } from "./galaxyBodyScan.js";
import { commanderSectorsDto } from "./galaxySectorTiers.js";
import { createUpdateChecker, currentReleaseForm } from "./updateCheck.js";
import { createAppUpdater, resolveUpdateDir } from "./appUpdater.js";
import { createWhatsNew } from "./whatsNew.js";
import { installLogRing } from "./diagnostics.js";
import { createUnknownExobioLog } from "./exobioUnknown.js";
import { parseHost, parsePort } from "./cliOptions.js";
import type { CliOptions } from "./cliOptions.js";
import { showEdexoNativeFixInfo, logFatal, assertResourceLayout } from "./startupChecks.js";
import { createGggResearch } from "./gggResearch.js";
import { createNoticesService } from "./notices.js";
import { communityGoalNoticeText, startCommunityGoalPoller } from "./communityGoals.js";
import { startDataAutoRefresh } from "./dataAutoRefresh.js";
import { createBookmarksService } from "./bookmarks.js";
import { spawn } from "node:child_process";
import { createBoxelRun } from "./boxelRun.js";
import { createSavedBoxels } from "./savedBoxels.js";
import { createNeutronLive } from "./neutronLive.js";
import { createNeutronReplanner } from "./neutronReplan.js";
import { createNeutronFuelWatch, storeFuel } from "./neutronFuelWatch.js";
import { createGreenGiantMarks, greenGiantForRecord } from "./greenGiants.js";
import { createNoticesWiring } from "./noticesWiring.js";
import { addSnapshotExtras } from "./snapshotExtras.js";
import { createJournalSideFiles } from "./journalSideFiles.js";
import { createRemoteSystemView } from "./remoteSystemView.js";
import { createStatusReader } from "./appStatus.js";
import { bodyKey } from "../shared/bodyKey.js";
import {
  applyPersistedUserPrefs as applyUserPrefs,
  persistUserPreferences as writeUserPrefs,
  tryReadUserPrefs,
  type PersistedUserPrefs,
} from "./userPrefsFile.js";
import { createImportDumpJob } from "./importDumpJob.js";
import { createCommunityUploads } from "./communityUploads.js";
import { createStatusPoller } from "./statusPoller.js";
import { createJournalPipeline } from "./journalPipeline.js";
import { createSpeciesDataWatcher } from "./speciesDataWatcher.js";
import { reloadSpeciesDerivedCaches } from "./speciesCacheReload.js";
import { pickCommanderForRun } from "./commanderMigration.js";
import { createCommanderWatch } from "./commanderWatch.js";
import { carrierHereOf, createCarrierRouteFollow } from "./carrierRouteFollow.js";
import { createCodexFirstAnnounce } from "./codexFirstAnnounce.js";
import { createPushScheduler } from "./pushScheduler.js";
import { createLiveJournalLine } from "./liveJournalLine.js";
import { createStatusTick } from "./statusTick.js";
import { mySystemsOptions } from "./mySystemsOptions.js";
import { noticesOptions } from "./noticesOptions.js";
import { uploadSettingsOptions } from "./uploadSettingsOptions.js";
import { updateDiagnosticsOptions } from "./updateDiagnosticsOptions.js";
import { prefsOptions } from "./prefsOptions.js";
import { speciesInfoOptions } from "./speciesInfoOptions.js";
import { errorText } from "./errorText.js";
export { backfillCommanderPosition } from "./commanderPositionBackfill.js";
export { logFatal, assertResourceLayout } from "./startupChecks.js";
export { parseHost, parsePort, parseCli } from "./cliOptions.js";
export type { CliOptions } from "./cliOptions.js";

export type EdexoRuntime = {
  ready: Promise<void>;
  /**
   * The journal boot is over (cache read or replay, the first push), or failed: the server's thread is free
   * again. The desktop app serves its pages from disk until then (electron/staticShell.cjs).
   */
  booted: Promise<void>;
  shutdown: () => Promise<void>;
  /** A backup is being written: Electron asks before an exit throws it away (backupService.ts). */
  backupRunning: () => boolean;
  whenBackupDone: () => Promise<void>;
  /**
   * Whether Elite is running, for the HUD overlays (hidden while it is not; gamePresence.ts).
   * The callback runs on every change; returns an unsubscribe.
   */
  onGameRunning: (cb: (running: boolean) => void) => () => void;
  gameRunning: () => boolean | null;
  getLocalBaseUrl: () => string;
  openMainAppInBrowser: () => void;
  /** Write what is buffered, synchronously: Windows logoff/shutdown gives no time for shutdown(). */
  flushNow: () => void;
  /** Tell the app pages to do something the commander asked for with a key bind. */
  uiCommand: (cmd: UiCommand) => void;
  /** The Clear notices key (owner, 2026-10-05): every notice marked read, then the read ones cleared. */
  clearNotices: () => number;
  /** The clear key (exoOrganicTracker.ts pressClearMarksHere): press twice to clear this planet's marks. */
  clearPlanetMarks: () => { armed: number } | { cleared: number } | null;
  /**
   * Boxel scanning keys (server/boxelRun.ts): copy the next system to fly, step to the previous / next
   * one still to fly, start or finish a run. Each returns the name copied (or the run's state).
   */
  boxelCopyNext: () => string | null;
  boxelStep: (dir: -1 | 1) => string | null;
  boxelRunToggle: () => { running: boolean; boxel: string; copied: string | null } | null;
  /** The clipboard writer: the desktop app subscribes; returns an unsubscribe. */
  onBoxelNext: (cb: (name: string) => void) => () => void;
  /**
   * The downloaded, checked update waiting for a restart, and the folder it sits in; null when there
   * is none (appUpdater.ts). Electron installs it on the way out (electron/updater.cjs).
   */
  stagedUpdate: () => { version: string; form: string; file: string; sha256: string; dir: string } | null;
};

export async function startEdexo(cli: CliOptions): Promise<EdexoRuntime> {
  // The app's own prediction log (predictionAuditLog.ts); scripts that run the snapshot code never write it.
  enablePredictionAudit();
  // First, so the warnings of the start are in Copy diagnostics too (diagnostics.ts).
  installLogRing();
  assertResourceLayout();
  startPerfReporter();

  // Before anything reads user data: fold in whatever the old Electron directory still holds (§47).
  for (const line of describeUserDataMigration(migrateLegacyUserData())) console.log(line);
  // A restore chosen in the launcher is staged, not applied, while the app runs: it lands here, at the
  // next start, before anything below reads the app data (backup.ts).
  try {
    for (const line of applyPendingRestore(path.dirname(resolveUserSettingsJsonPath()))) console.log(line);
  } catch (e) {
    console.error("restore: could not apply the staged restore:", e);
  }

  const projectRoot = getProjectRoot();
  const updateChecker = createUpdateChecker();
  const appUpdater = createAppUpdater({
    newerAsset: () => updateChecker.newerAsset(),
    form: currentReleaseForm(),
  });
  const whatsNew = createWhatsNew({
    check: () => updateChecker.check(false),
    notesBetween: (from, to) => updateChecker.notesBetween(from, to),
    lastError: () => updateChecker.lastError(),
  });

  let journalDir = resolveInitialJournalDir(projectRoot);
  /*
    Whose data this run shows (per-commander profiles, 1.3.1): picked from every journal before anything below reads
    a journal or a commander's file, and the files from before 1.3.1 moved into that commander's folder once.
  */
  await pickCommanderForRun(journalDir);

  const store = new GameStateStore();
  /*
    The radar's memory, before any journal is read.

    The owner's ask: "overlay/radar should read Status.json + latest Journal logs on launch". The
    journal half happens anyway — the replay below picks up Touchdown and puts the ship back — and
    Status.json is polled from the first tick. This is the half neither of those can supply: where
    the plants were, which exists only because a previous run of this app recorded it.

    Loaded first so a journal replay can overwrite it with something newer rather than the other way
    round.
  */
  store.loadSurfaceMarksFromDisk();
  // NavRoute.json and Status.json beside the journals: the live route, the fuel, the per-batch read (journalSideFiles.ts).
  const { applyNavRoute, readLiveNavRouteWaypoints, refreshLiveHudFromJournalDir, liveSideFiles } = createJournalSideFiles({
    store,
    getJournalDir: () => journalDir,
  });

  const userSettingsPath = resolveUserSettingsJsonPath();
  const legacyUserSettingsPath = path.join(projectRoot, USER_SETTINGS_FILENAME);

  // The settings file lives in userPrefsFile.ts; these keep the old names for the wiring below.
  const persistUserPreferences = (): void => writeUserPrefs(store, userSettingsPath);
  const applyPersistedUserPrefs = (j: PersistedUserPrefs): void => applyUserPrefs(store, j);

  {
    const primary = tryReadUserPrefs(userSettingsPath);
    if (primary) {
      applyPersistedUserPrefs(primary);
    } else {
      const legacy = tryReadUserPrefs(legacyUserSettingsPath);
      if (legacy) {
        applyPersistedUserPrefs(legacy);
        persistUserPreferences();
      }
    }
  }

  const { bindHost, port, shouldOpenMainUI, quietConsole, useShellLauncher } = cli;

  /**
   * `0.0.0.0` means every device on the network can reach the mutating endpoints, so a bind that
   * wide gets an access key. A loopback bind gets none — there is nothing there a local process
   * could not already do.
   */
  // Any address but this PC's own is the network, and needs the key: `--host 192.0.2.10` or `--host ::`
  // used to run with no key at all because only 0.0.0.0 counted (combined plan 1.4).
  const lanExposed = !isLoopbackHostName(bindHost);
  const lanKey = lanExposed ? loadOrCreateLanKey(resolveLanKeyPath()) : null;
  /*
    Read for every snapshot and every status poll in LAN mode, and `os.networkInterfaces()` is slow on
    Windows with VPN or Hyper-V adapters; the addresses change rarely, so 30 s old is fresh enough
    (code review D7, 2026-10-14).
  */
  let lanUrlsCache: { at: number; urls: string[] } | null = null;
  const lanUrlsWithKey = (): string[] => {
    const now = Date.now();
    if (!lanUrlsCache || now - lanUrlsCache.at > 30_000) {
      lanUrlsCache = { at: now, urls: getLanIPv4s(port).map((u) => lanUrlWithKey(u, lanKey)) };
    }
    return lanUrlsCache.urls;
  };

  const sessionLog = new SessionLog();
  // New exobiology journal shapes (the Nomad, the Mk II scanner) kept for teaching the app (F-5.13).
  const unknownExobio = createUnknownExobioLog(
    path.join(path.dirname(resolveUserSettingsJsonPath()), "unknown-exobiology-events.jsonl"),
    (key) => console.warn(`[edexo-compare] unknown exobiology journal line kept: ${key}`),
  );
  /* "Notify me" (guild tester report, 2026-09-30): the mail icon's notices and the record marks. */
  /*
    Achievement notices (owner, 2026-10-05): only steps reached after this start — primed before the
    first live line, read again when a set it counts from grows (server/achievementNotices.ts).
  */
  const achievementWatch = createAchievementWatch({
    read: () => {
      const l = achievementsList(getProjectRoot(), store, getCachedSpeciesDatabase().species);
      return l.available ? l.achievements : null;
    },
    version: () => `${store.achievementDone.size}|${store.codexMapLogged.size}|${store.visitedSystems.size}`,
  });
  const notices = createNoticesService({
    filePath: path.join(resolveCommanderDataDir(), "edexo-notices.json"),
  });
  setCodexFirstLowChanceKept(() => notices.prefs().codexFirstLowChance ?? true);
  /* The nudge research log: the developer's PC only, where `ggg-research.on` is (server/gggResearch.ts). */
  const gggResearch = createGggResearch({
    dir: path.dirname(resolveUserSettingsJsonPath()),
    notify: (n, at) => notices.announceGggResearch(n, at),
  });
  const savedBoxels = createSavedBoxels({
    filePath: path.join(resolveCommanderDataDir(), "edexo-boxels.json"),
    visitedAt: (addr) => store.systemVisitedAt.get(addr) ?? null,
    // A boxel run takes the clipboard over from a neutron route being flown (plan 8.5).
    onRun: (id) => {
      if (id && neutronLive.active()) {
        neutronLive.stop();
        neutronStopped();
      }
    },
  });
  /*
    Boxel scanning (owner, 2026-10-06, after EDJP's routing mode; server/boxelRun.ts): the next system to
    fly goes to the clipboard after each jump, and key binds start / finish a run and step through the
    boxel. The desktop app writes the clipboard (it subscribes); without it, on Windows, `clip` does.
  */
  const boxelNextListeners = new Set<(name: string) => void>();
  const deliverToClipboard = (name: string, source: "boxel" | "neutron" = "boxel"): void => {
    // The HUD's next-jump card says what is on the clipboard: a key press in the game shows nothing else.
    store.boxelCopied = {
      name,
      at: new Date().toISOString(),
      run: source === "boxel" && savedBoxels.runId() != null,
      source,
    };
    store.boxelsRevision++;
    queueMicrotask(() => push());
    if (boxelNextListeners.size) {
      for (const cb of boxelNextListeners) cb(name);
      return;
    }
    if (process.platform !== "win32") return;
    try {
      const clip = spawn("clip", [], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
      clip.on("error", () => {});
      clip.stdin.end(name);
    } catch {
      /* no clipboard: nothing to do */
    }
  };
  const boxelRun = createBoxelRun({
    saved: savedBoxels,
    visited: () => store.visitedSystems.entries(),
    sightings: () => [...navRouteLog().systems, ...store.targetedSystems.values()],
    currentSystem: () => store.currentSystem,
    deliver: deliverToClipboard,
    here: () => (store.commanderPos ? [store.commanderPos.x, store.commanderPos.y, store.commanderPos.z] : null),
  });
  /*
    A neutron route being flown (plan 8.5, server/neutronLive.ts): its next stop goes to the clipboard after each
    jump onto a stop, the same way; starting one ends the boxel run.
  */
  const neutronLive = createNeutronLive({
    filePath: path.join(resolveCommanderDataDir(), "edexo-neutron-live.json"),
    deliver: (name) => deliverToClipboard(name, "neutron"),
    onStart: () => void (savedBoxels.runId() && savedBoxels.setRun(null)),
    onDone: () => neutronStopped(),
    carrierHere: () => carrierHereOf(store),
  });
  const shipHere = () => ({ name: store.currentSystem ?? null, pos: store.commanderPos ?? null });
  /** Stopped: the HUD's "Copied … · neutron route" line goes with it (owner, 2026-10-13: it stayed). */
  const neutronStopped = (): void => {
    if (store.boxelCopied?.source === "neutron") store.boxelCopied = null;
    store.boxelsRevision++;
    push();
  };
  /* Off the route: planned again from where the ship is (server/neutronReplan.ts). */
  const neutronReplanner = createNeutronReplanner({ store, neutronLive, push: () => push(), shipHere });
  /* More or less fuel than the plan had: planned again from here too (plan 1.3.4 S-9, server/neutronFuelWatch.ts). */
  const fuelReplan = (why: string, fuelT: number) => void neutronReplanner.replan({ why, fuelT });
  // A Spansh carrier route follows his carrier's arrivals instead of the ship's jumps (plan 1.3.6).
  const carrierFollow = createCarrierRouteFollow({ store, neutronLive, push: () => push() });
  const neutronFuelWatch = createNeutronFuelWatch({ neutronLive, shipHere, fuel: () => storeFuel(store) }, fuelReplan);
  const bookmarks = createBookmarksService({ filePath: path.join(resolveCommanderDataDir(), "edexo-bookmarks.json") });
  /* Green gas giants (owner, 2026-09-30): the commander's own calls, and what the verdict reads. */
  const greenMarks = createGreenGiantMarks({
    filePath: path.join(path.dirname(resolveUserSettingsJsonPath()), "edexo-ggg-marks.json"),
  });
  // The green gas giants' sources, the Notable card's options and the notices' view of the store (noticesWiring.ts).
  const { greenExtras, greenSources, scanOf, mainStarTypeOf, noticesContext } = createNoticesWiring({
    store,
    notices,
    greenMarks,
  });
  const getSnapshot = () =>
    perfTime("buildSnapshot", () => {
      const snap = buildSnapshot(
        store,
        journal.path(),
        journalDir,
        bindHost,
        port,
        lanExposed ? lanUrlsWithKey() : [],
        journal.filesMerged(),
        journal.bootProgress(),
        sessionLog.toDto(),
      );
      // What the journal store does not hold: notices, the NSP card, the neutron route, the FSD, bookmarks (snapshotExtras.ts).
      addSnapshotExtras(snap, { store, notices, neutronLive, shipHere, bookmarks, commanderWatch, mainStarTypeOf });
      return snap;
    });

  // "Import Spansh export" from the launcher (importDumpJob.ts).
  const importDump = createImportDumpJob();

  // A system the journals do not know, from Spansh; the gate before a galaxy source fills a map (remoteSystemView.ts).
  const { ensureRemoteSystem, hydrateGate } = createRemoteSystemView({ store, push: () => push() });

  let broadcast: (s: AppSnapshot) => void = () => {};

  const announceCodexFirstIn = createCodexFirstAnnounce({ store, notices });

  /**
   * Broadcast, then consume the one-shot UI auto-select key.
   *
   * The consume used to live inside buildSnapshot, which /api/state and the launcher poll also
   * called — whichever poller arrived first swallowed the key, so "focus the body you just
   * scanned" silently failed and, with two clients, at most one ever saw it.
   */
  // Guarded: it runs on timers too, and a throw there would end the server process (guarded.ts).
  const broadcastSnapshot = guarded("snapshot push", () => {
    const snap = getSnapshot();
    announceCodexFirstIn(snap);
    broadcast(snap);
    store.clearPendingUiAutoSelectBodyKey();
  });

  // Journal-driven pushes coalesced to one a window (pushScheduler.ts).
  const { push, pushFlush } = createPushScheduler(broadcastSnapshot);

  // The HUD's Colonize section follows the Colonize store and its saved plan, not the journal store.
  const offColonizeHud = onColonizeHudChange(push);
  // Who the game is playing and every commander the journals name (per-commander profiles, 1.3.1).
  const commanderWatch = createCommanderWatch({ getJournalDir: () => journalDir, onChange: () => push() });


  /**
   * The radar's frame, for {@link ExoLiveDTO}.
   *
   * Deliberately not `getSnapshot()`. These two builders read the store and the price index and
   * nothing else; the snapshot rebuilds every body, every match and every derived list to arrive at
   * the same two fields, which is why the radar was pinned to the 250 ms coalescing window.
   */
  const buildExoLive = (): ExoLiveDTO => ({
    exoOrganicOverlay: buildExoOrganicOverlayDto(store, getCachedPrices()),
    exoMinimap: buildExoMinimapDto(
      store,
      store.exoOrganicTracker?.bodyKey ?? store.overlayTouchdownBodyKey,
      store.exoOrganicTracker ? Math.max(0, Math.round(store.exoOrganicTracker.minSampleDistanceM)) : 0,
    ),
  });

  // `Status.json`: the game's writes, with an interval as the backstop (statusPoller.ts).
  const statusPoller = createStatusPoller({ store, getJournalDir: () => journalDir });

  /**
   * Both live-file poll rates, applied to the running timers at once.
   *
   * The whole point of the setting is that it takes effect now: the commander changes the number in
   * the launcher and the next tick is at the new rate, with no relaunch and no journal-pipeline
   * restart. Persisted only when something actually changed.
   */
  function applyPollRates(
    statusRaw: unknown,
    journalRaw: unknown,
  ): { statusPollMs: number; journalPollMs: number } {
    const changed = store.setPollRates(statusRaw, journalRaw);
    if (changed) {
      statusPoller.arm();
      journal.retimePoll();
      persistUserPreferences();
    }
    return { statusPollMs: store.statusPollMs, journalPollMs: store.journalPollMs };
  }

  function getJournalListFilterOpts(): JournalListFilterOpts {
    return { minFileStartUtcMs: journalHistoryCutoffUtcMs(store.journalHistoryPreset) };
  }

  // EDSM, Canonn and EDDN: hydration on jump, the upload catch-up and live loop, the live-tail senders.
  const uploads = createCommunityUploads({
    store,
    push: () => push(),
    getJournalDir: () => journalDir,
    getJournalPath: () => journal.path(),
  });
  const { canonnUploader, eddnUploader, maybeAutoFetchOnArrival, primeEddnFromNewestJournal } = uploads;

  // Community Goals: Frontier's public list, hourly while Notify me → Community goals is on (communityGoals.ts).
  startCommunityGoalPoller({
    enabled: () => notices.prefs().communityGoals,
    userAgent: APP_USER_AGENT,
    onGoals: (goals) => {
      const at = new Date().toISOString();
      let added = false;
      for (const g of goals) {
        if (notices.announceCommunityGoal({ id: g.id, title: g.title, system: g.system, text: communityGoalNoticeText(g) }, at))
          added = true;
      }
      if (added) push();
    },
  });

  // Carriers & Stations refresh themselves once fetched (dataAutoRefresh.ts): 12 h / 24 h unless changed.
  const dataAutoRefresh = startDataAutoRefresh(() => push());

  // What one live line does (liveJournalLine.ts); built when the tail starts, after every service below exists.
  const liveJournalLine = () =>
    createLiveJournalLine({
      store,
      projectRoot,
      notices,
      noticesContext,
      gggResearch,
      achievementWatch,
      maybeAutoFetchOnArrival,
      canonnUploader,
      eddnUploader,
      liveSideFiles,
      applyNavRoute,
      carrierFollow,
      neutronLive,
      neutronReplanner,
      neutronFuelWatch,
      shipHere,
      boxelRun,
      savedBoxels,
      sessionLog,
      unknownExobio,
      backupService,
      gamePresence,
      push,
    });

  // The journal replay, its cache and the live tail (journalPipeline.ts).
  const journal = createJournalPipeline({
    store,
    projectRoot,
    quietConsole,
    getJournalDir: () => journalDir,
    getJournalListFilterOpts,
    createLiveJournalLine: liveJournalLine,
    notices,
    unknownExobio,
    pushFlush,
    refreshLiveHudFromJournalDir,
    primeEddnFromNewestJournal,
  });

  // The launcher's status (appStatus.ts).
  const getStatus = createStatusReader({
    store,
    journal,
    commanderWatch,
    getJournalDir: () => journalDir,
    bindHost,
    port,
    lanExposed,
    lanKeyRequired: lanKey != null,
    lanToggle: cli.lanToggle === true,
    lanUrlsWithKey,
  });

  async function applyNewJournalDirectory(nextRaw: string): Promise<{ ok: boolean; error?: string }> {
    const next = path.normalize(nextRaw.trim());
    if (!next || !existsSync(next)) {
      return { ok: false, error: "Path does not exist." };
    }
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(next);
    } catch {
      return { ok: false, error: "Cannot read path." };
    }
    if (!st.isDirectory()) {
      return { ok: false, error: "Journal path must be a folder." };
    }

    journalDir = next;
    persistJournalDirPreference(next);
    process.env.ED_JOURNAL_DIR = next;

    await journal.restart();
    // The Status.json watch is bound to the old folder; without this the HUD would keep waiting for
    // writes that now happen somewhere else, and fall back to the interval without saying so.
    statusPoller.watch();
    pushFlush();
    return { ok: true };
  }

  // The species tree and price list on disk: a change reloads the database (speciesDataWatcher.ts).
  const speciesWatch = createSpeciesDataWatcher({ projectRoot, push: () => push() });

  /** The launcher's Exomastery downloads; the backups put the same two files in every zip. */
  const exportOwn = (kind: "exomastery" | "codex") => {
    const commander = { name: store.commanderName, fid: commanderIdHash(store.commanderFid) };
    if (kind === "codex") {
      const keys = new Set([...store.codexRegionLogged, ...ownCodexBackupKeys()]);
      return { fileName: exportFileName("codex", commander.name), body: buildCodexExport(keys, commander) };
    }
    return {
      fileName: exportFileName("exomastery", commander.name),
      body: buildExomasteryExport(ownFootEntriesWithBackups(getProjectRoot()), commander),
    };
  };

  const getStatisticsScan = async () =>
    scanJournalsForStatistics(await listJournalFilesChronological(journalDir, getJournalListFilterOpts()));

  /*
    Prepared in the background a while after start (UI review P7, 2026-09-29), so the first open of
    Statistics and the Encyclopedia is instant instead of "Reading your journals…" for seconds: the
    statistics parts for every journal but the one being written to, and the Encyclopedia's rows.
    Late enough not to compete with the journal boot and the first pushes.
  */
  const WARM_UP_AFTER_BOOT_MS = 20_000;
  let warmUpTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleWarmUp = () => {
    if (warmUpTimer != null) clearTimeout(warmUpTimer);
    warmUpTimer = setTimeout(() => {
      warmUpTimer = null;
      try {
        buildEncyclopediaPayload();
        buildFieldGuide(projectRoot, getCachedSpeciesDatabase());
      } catch {
        /* the Encyclopedia builds on open instead */
      }
      void getStatisticsScan().catch(() => {
        /* Statistics scans on open instead */
      });
    }, WARM_UP_AFTER_BOOT_MS);
    warmUpTimer.unref?.();
  };

  // The process check only matters to the desktop app's overlays; a plain server does not poll.
  const gamePresence = createGamePresence({ autoStart: process.env.EDEXO_ELECTRON === "1" });
  // The fuel's "live" only while the game runs: a closed game leaves its last Status.json behind (neutronShip.ts).
  gamePresence.onChange((running) => {
    store.gameRunning = running;
  });

  const backupService = createBackupService({
    appDataDir: path.dirname(userSettingsPath),
    getJournalDir: () => journalDir,
    getCommander: () => store.commanderName,
    appVersion: APP_VERSION,
    exports: () => [exportOwn("exomastery"), exportOwn("codex")],
  });

  const {
    server,
    broadcast: broadcastFn,
    broadcastExoLive,
    broadcastUiCommand,
    listening,
    closeConnections,
  } = createHttpServer({
    backup: backupService,
    port,
    bindHost,
    lanKey,
    getSnapshot,
    getJournalDir: () => journalDir,
    getStatus,
    getCommanders: () => commanderWatch.state(),
    getCommanderPosition: () => store.commanderPos,
    getFirstDiscoveryBacklog: () => firstDiscoveryBacklogWithDistance(store),
    getBacklogMap: async () => backlogMap(store, await firstDiscoveryBacklogSliced(store)),
    getDiscoveries: () => buildDiscoveries(store, getProjectRoot(), greenExtras),
    searchGalaxyByValue: (query, limit) => galaxyValueSearch({ ...query, from: store.commanderPos, limit }),
    getGalaxySpecies: () => galaxySpeciesCatalogue(),
    getGalaxyRegions: () => galaxyRegions(),
    scanGalaxyBodies: (query, limit) => galaxyBodyScan({ ...query, from: store.commanderPos, limit }),
    getCommanderSectors: () => commanderSectorsDto(store),
    ...mySystemsOptions({ store, sessionLog }),
    getJournalStore: () => store,
    getCodexMapLogged: () => store.codexMapLogged,
    getAchievements: () => achievementsList(getProjectRoot(), store, getCachedSpeciesDatabase().species),
    getAchievementDetail: (id) =>
      achievementDetail(getProjectRoot(), store, getCachedSpeciesDatabase().species, id),
    trackAchievement: (id) => {
      if (
        id !== null &&
        !achievementExists(getProjectRoot(), store, getCachedSpeciesDatabase().species, id)
      ) {
        return false;
      }
      store.setTrackedAchievement(id);
      persistUserPreferences();
      return true;
    },
    getCommanderSystem: () => store.currentSystem,
    setPollRates: (statusMs, journalMs) => applyPollRates(statusMs, journalMs),
    bookmarks,
    savedBoxels,
    neutronLive,
    shipHere,
    onNeutronStopped: neutronStopped,
    ownGreenGiants: () => {
      const out: { x: number; y: number; z: number; body: string; system: string }[] = [];
      const src = greenSources();
      const keys = new Set([
        ...store.greenCodexBodies.keys(),
        ...[...greenMarks.all()].filter(([, m]) => m.mark === "yes").map(([k]) => k),
      ]);
      for (const k of keys) {
        const rec = scanOf(k);
        const pos = rec ? store.systemPositions.get(rec.systemAddress) : undefined;
        if (!rec || !pos) continue;
        const v = greenGiantForRecord(rec, src);
        if (v?.level === "confirmed" && !v.gggNumber)
          out.push({ ...pos, body: rec.bodyName, system: rec.starSystem });
      }
      return out;
    },
    setGreenGiantMark: (systemAddress, bodyId, mark) => {
      const rec = scanOf(bodyKey(systemAddress, bodyId));
      if (!rec) return false;
      greenMarks.set(bodyKey(systemAddress, bodyId), mark, { body: rec.bodyName, system: rec.starSystem });
      return greenGiantForRecord(rec, greenSources());
    },
    systemPositionOf: (addr) => store.systemPositions.get(addr) ?? null,
    ...noticesOptions({ notices, noticesContext, push }),
    setRadarRadiusM: (raw) => {
      /*
        Pushed as well as persisted. The radar is drawn from a field on its DTO, so a client that is
        not looking at a live fix right now would otherwise keep the old circle until the next
        sample — and the commander changing this is, by definition, looking at the radar.
      */
      if (store.setMinimapRadiusM(raw)) {
        persistUserPreferences();
        statusPoller.noteRan();
        if (store.exoOrganicTracker || store.overlayTouchdownBodyKey) broadcastExoLive(buildExoLive());
        push();
      }
      return store.minimapRadiusM;
    },
    ...prefsOptions({ store, persistUserPreferences, push }),
    /*
      The launcher's "open in browser" and "phone view". The path is chosen here from the views'
      own table (appViews.ts) rather than taken from the caller, so the route cannot be used to
      launch anything but this app's own views.
    */
    openAppView: (view) => {
      openUrlInBrowser(appViewUrl(port, view));
      return { ok: true };
    },
    openExoMissLog: () => {
      const file = resolveExoOutlierLogPath();
      // The panel that offers this is hidden at zero misses, so a missing file means the log was
      // deleted between the snapshot and the click. Say which file rather than failing blankly —
      // the path is the useful half of the answer either way.
      if (!existsSync(file)) return { ok: false, error: `No miss log yet: ${file}` };
      openLocalFile(file);
      return { ok: true };
    },
    /*
      Everything the app holds in memory from `data/`, dropped together.

      This is the launcher's "Refresh exomastery", and it makes one promise: the files on disk are
      re-read. Three caches added later — the ED-DSN colour tables, the photo credits manifest and
      the region x species table — were never listed here, so editing any of those files and
      pressing the button did nothing at all, silently. The owner asked whether it still worked
      after a session of changes; it did not, for those three.

      Anything that memoises a file under `data/` belongs on this list. There is no mechanism that
      enforces that, which is why it is written down.
    */
    exportExomastery: exportOwn,
    reloadExomastery: () => {
      clearSharedExomasteryCache();
      speciesWatch.retarget();
      reloadSpeciesDerivedCaches();
      loadSpeciesDatabase();
      pushFlush();
    },
    writeExoDataAlertFix: (alert) => {
      const out = writeExoDataAlertFixFiles(getCachedSpeciesDatabase(), alert);
      if (out.ok) {
        loadSpeciesDatabase();
        pushFlush();
      }
      return out;
    },
    showFixStubNativeDialog: showEdexoNativeFixInfo,
    clearExomasteryProfileCache: () => {
      reloadSpeciesDerivedCaches();
      // The tree too (review 2026-11-10 §5): entries carry observedTemperatureK / colourVariant from the profiles.
      loadSpeciesDatabase();
    },
    resetExobiology: () => {
      store.resetExobiologyTracking();
    },
    setViewingSystem: (addr) => {
      store.setViewingSystemAddress(addr);
    },
    rememberVisitedSystem: (starSystem, systemAddress) => {
      store.rememberVisitedSystem(starSystem, systemAddress);
    },
    lookupSystem: (systemAddress, starSystem) => {
      void ensureRemoteSystem(systemAddress, starSystem);
    },
    setUiSelectedBodyKey: (key) => store.setUiSelectedBodyKeyFromClient(key),
    focusUiBody: (key) => {
      const sep = key.indexOf(":");
      const systemAddress = Number(key.slice(0, sep));
      const bodyId = Number(key.slice(sep + 1));
      if (sep > 0 && Number.isFinite(systemAddress) && Number.isFinite(bodyId)) store.requestUiAutoSelectBody(systemAddress, bodyId);
    },
    setJournalDirectory: applyNewJournalDirectory,
    setJournalHistoryPreset: async (preset) => {
      if (store.journalHistoryPreset === preset) {
        pushFlush();
        return;
      }
      store.setJournalHistoryPreset(preset);
      persistUserPreferences();
      await journal.restart();
      pushFlush();
    },
    searchEdsmSystems: (query) => searchEdsmSystemsByName(query),
    getStatisticsScan,
    searchSpanshSystems: (query) => searchSpanshSystemsByName(query),
    ...uploadSettingsOptions({ store, persistUserPreferences, uploads, hydrateGate }),
    scheduleBroadcast: push,
    ...speciesInfoOptions({ store, projectRoot }),
    ...updateDiagnosticsOptions({
      store,
      projectRoot,
      getStatus,
      journal,
      gamePresence,
      updateChecker,
      appUpdater,
      whatsNew,
    }),
    startImportDump: importDump.start,
    getImportDumpStatus: importDump.statusFor,
  });
  broadcast = broadcastFn;

  let readyResolve!: () => void;
  let readyReject!: (e: unknown) => void;
  let listeningSettled = false;
  const ready = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  let bootedResolve!: () => void;
  const booted = new Promise<void>((res) => {
    bootedResolve = res;
  });
  // The EDDN collector's codex ledger, when one runs on this machine: fresher [CODEX FIRST] (eddnLedger.ts). After
  // the journal boot: its first answer is the whole export (43 MB on the owner's PC).
  startEddnLedgerWatch(getProjectRoot(), booted);

  /** Must await `listening` immediately — if it rejects before a consumer attaches, devEntry's
   * `unhandledRejection` handler exits the process and Electron shows nothing. */
  void (async () => {
    try {
      await listening;
      listeningSettled = true;
      pushFlush();

      const url = `http://${bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost}:${port}`;
      if (!quietConsole) {
        console.info(`ED Exo Compare — journal dir: ${journalDir}`);
        console.info(`HTTP + WS: ${url}`);
        if (lanExposed) {
          const lan = lanUrlsWithKey();
          if (lan.length) {
            console.info("On your phone (same Wi‑Fi):", lan.join("  "));
            console.info(
              "Other devices need the ?k= access key in that link; this PC never does. " +
                `Key file: ${resolveLanKeyPath()}`,
            );
          }
        }
      }

      const launcherUrl = `${url}/launcher.html`;
      if (useShellLauncher) {
        openLauncherShell(launcherUrl);
      }

      if (shouldOpenMainUI) openUrlInBrowser(url);

      readyResolve();

      await journal.restart();

      statusPoller.setTick(
        createStatusTick({
          store,
          getJournalDir: () => journalDir,
          gameIsAnotherCommander: () => commanderWatch.gameIsAnotherCommander(),
          applyNavRoute,
          readLiveNavRouteWaypoints,
          broadcastExoLive,
          buildExoLive,
          push,
        }),
      );
      statusPoller.arm(true);
      statusPoller.watch();

      /*
        A sample already in progress when the app started.

        `ingestExoOrganicJournalLine` runs on live lines only — replaying four years of scans would
        fire a celebration for each — so a plant half-sampled while the app was closed was invisible
        and the overlay said zero scans. The owner scanned one and was told none.

        Only the newest log, and only back to the last landing: a sample happens in one visit to one
        surface. Count only — the positions are not in the journal and must not be guessed.
      */
      const journalPath = journal.path();
      if (journalPath) {
        try {
          const tail: JournalLine[] = [];
          await readJournalFull(journalPath, (l) => tail.push(l));
          if (restoreOrganicSessionFromJournal(store, tail, projectRoot, getCachedSpeciesDatabase())) {
            pushFlush();
          }
        } catch {
          /* An unreadable log costs a restored count, never the boot. */
        }
      }

      pushFlush();

      if (!quietConsole) {
        console.info(`Merged ${journal.filesMerged()} journal log file(s) (oldest → newest), tailing latest.`);
      }
      scheduleWarmUp();
      bootedResolve();
    } catch (e) {
      bootedResolve();
      if (!listeningSettled) {
        readyReject(e);
      } else {
        console.error(e);
        journal.endBootProgress();
        pushFlush();
      }
      if (process.env.EDEXO_ELECTRON === "1") {
        return;
      }
      if (!listeningSettled) {
        const msg = errorText(e);
        logFatal(["ED Exo Compare — startup failed:", msg]);
      }
    }
  })();

  speciesWatch.start();

  await ready;

  const shutdown = async () => {
    if (warmUpTimer != null) clearTimeout(warmUpTimer);
    // The foot catalog writes at most once a second; closing must not drop the last second. Nor the other
    // debounced savers (code review 2026-10-10, A4): their timers die with the process.
    flushFootScannedCatalog();
    flushPredictionAudit();
    flushSurfaceMarks();
    flushPendingOrganicSampleSession();
    flushNavRouteLog();
    backupService.dispose();
    gamePresence.dispose();
    dataAutoRefresh.stop();
    statusPoller.stop();
    commanderWatch.stop();
    speciesWatch.stop();
    await journal.close();
    // Colonize, if a window started it: its depot state and buy index are saved on a debounce.
    offColonizeHud();
    await stopColonizeService().catch((e) => console.error("[colonize] stop failed:", e));
    // Open sockets (a phone, a browser tab) would otherwise hold the close until the app ends the process.
    closeConnections();
    await new Promise<void>((res) => {
      server.close(() => res());
    });
  };

  return {
    ready,
    booted,
    shutdown,
    getLocalBaseUrl: () => `http://127.0.0.1:${port}`,
    openMainAppInBrowser: () => openUrlInBrowser(`http://127.0.0.1:${port}/`),
    backupRunning: () => backupService.isRunning(),
    whenBackupDone: () => backupService.whenIdle(),
    onGameRunning: (cb) => gamePresence.onChange(cb),
    gameRunning: () => gamePresence.running(),
    flushNow: () => flushFootScannedCatalog(),
    uiCommand: (cmd) => broadcastUiCommand(cmd),
    clearNotices: () => {
      const n = notices.markRead("all") + notices.clearRead();
      if (n) push();
      return n;
    },
    clearPlanetMarks: () =>
      pressClearMarksHere(store, store.exoOrganicTracker?.bodyKey ?? store.overlayTouchdownBodyKey, Date.now(), push),
    // F6: the neutron route's next stop while one is flown, else the boxel's next system.
    boxelCopyNext: () => (neutronLive.active() ? neutronLive.copyNext() : boxelRun.copyNext()),
    boxelStep: (dir) => boxelRun.step(dir),
    boxelRunToggle: () => {
      const r = boxelRun.toggle();
      if (r && store.boxelCopied) store.boxelCopied.run = r.running;
      if (r) {
        store.boxelsRevision++;
        push();
      }
      return r;
    },
    onBoxelNext: (cb) => {
      boxelNextListeners.add(cb);
      return () => boxelNextListeners.delete(cb);
    },
    stagedUpdate: () => {
      const st = appUpdater.staged();
      // The hash too: Electron checks the file against it again on the way out (review 2026-11-10 D1).
      return st ? { version: st.version, form: st.form, file: st.file, sha256: st.sha256, dir: resolveUpdateDir() } : null;
    },
  };
}

/**
 * Where the desktop app listens, given the launch mode and whatever was typed after the exe.
 *
 * The port used to be hard-coded at 7111 and `--port` was simply dropped — so a second instance
 * could not be started beside a running one, which is the first thing anyone tries, and the flag
 * looked accepted because nothing complained. Same shape as `--local` being ignored by the console
 * wrappers: a flag that is silently discarded is worse than one that is rejected.
 *
 * The **mode** still decides the address, because that is what `--local` and `--client` mean to
 * `electron/main.cjs`. `--host` and `--lan` override it only when actually present: `parseHost`
 * answers `0.0.0.0` for an empty argv, and taking that unconditionally would put a client-mode
 * window on the network.
 */
export function electronRuntimeOptions(
  mode: "server" | "client",
  argv: readonly string[],
  /** The launcher's "LAN access" switch (launcherPrefs.ts); only server mode listens on the network. */
  lanAccess: boolean,
): { bindHost: string; port: number } {
  const explicitHost = electronHostIsExplicit(argv);
  return {
    bindHost: explicitHost ? parseHost([...argv]) : mode === "server" && lanAccess ? "0.0.0.0" : "127.0.0.1",
    port: parsePort([...argv]),
  };
}

function electronHostIsExplicit(argv: readonly string[]): boolean {
  return argv.includes("--host") || argv.includes("--lan");
}

export async function startEdexoFromElectronMode(
  mode: "server" | "client",
  argv: readonly string[] = process.argv,
): Promise<EdexoRuntime> {
  process.env.EDEXO_ELECTRON = "1";
  // The switch decides only when nothing on the command line already has.
  const lanToggle = mode === "server" && !electronHostIsExplicit(argv);
  return startEdexo({
    ...electronRuntimeOptions(mode, argv, lanToggle ? resolveLanAccess() : false),
    shouldOpenMainUI: false,
    quietConsole: true,
    useShellLauncher: false,
    lanToggle,
  });
}
