import { flushNavRouteLog, navRouteLog } from "./navRouteLog.js";
import { enablePredictionAudit, flushPredictionAudit, predictionRecords } from "./predictionAuditLog.js";
import { predictionQuality } from "./predictionQuality.js";
import { cardVerdictsFor } from "./cardVerdicts.js";
import { flushSurfaceMarks } from "./surfaceMarksFile.js";
import { startEddnLedgerWatch } from "./eddnLedger.js";
import path from "node:path";
import { achievementDetail, achievementExists, achievementsList } from "./achievements.js";
import { achievementNoticeText, createAchievementWatch } from "./achievementNotices.js";
import {
  buildCodexExport,
  buildExomasteryExport,
  clearSharedExomasteryCache,
  commanderIdHash,
  exportFileName,
  ownCodexBackupKeys,
} from "./sharedExomastery.js";
import { ownFootEntriesWithBackups } from "./footScannedCatalog.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { AppSnapshot, ExoLiveDTO, JournalLine, UiCommand } from "../shared/types.js";
import { journalHistoryCutoffUtcMs } from "../shared/journalHistoryPreset.js";
import { mergeCollectionFocus } from "../shared/collectionFocus.js";
import {
  clearCollectionFocusCache,
  loadCollectionFocusConfig,
  saveCollectionFocusConfig,
  type CollectionFocusConfig,
} from "./collectionFocus.js";
import { openUrlInBrowser, openLauncherShell, openLocalFile } from "./openUrl.js";
import { GameStateStore } from "./gameState.js";
import {
  readJournalFull,
  listJournalFilesChronological,
  type JournalLineAt,
  type JournalListFilterOpts,
} from "./journalWatcher.js";
import { emitLiveJournalLine } from "./journalTap.js";
import { stopColonizeService } from "./colonize/colonizeService";
import { onColonizeHudChange } from "./colonize/hudSummary";
import { scanJournalsForStatistics } from "./statisticsScan.js";
import { createHttpServer, getLanIPv4s } from "./httpServer.js";
import { appViewUrl } from "./appViews.js";
import { describeUserDataMigration, migrateLegacyUserData } from "./userDataMigration.js";
import { resolveLanAccess } from "./launcherPrefs.js";
import { isLoopbackHostName } from "./lanAuth.js";
import { applyPendingRestore } from "./backup.js";
import { createBackupService } from "./backupService.js";
import { APP_USER_AGENT, APP_VERSION } from "./appVersion.js";
import os from "node:os";
import {
  edsmCredentialsStatus,
  forgetEdsmCredentials,
  readEdsmCredentials,
  saveEdsmCredentials,
} from "./edsmCredentials.js";
import { lanUrlWithKey, loadOrCreateLanKey } from "./lanAuth.js";
import { buildEncyclopediaExomasteryPlanetsPayload } from "./exomasteryEdsmEncyclopedia.js";
import {
  buildEncyclopediaPayload,
  buildSnapshot,
  findSpeciesEntryForEncyclopedia,
  getCachedSpeciesDatabase,
  setCodexFirstLowChanceKept,
  loadSpeciesDatabase,
  getCachedPrices,
} from "./snapshot.js";
import { writeExoDataAlertFixFiles } from "./exoDataAlertFix.js";
import { buildFeederStatus } from "./feederStatus.js";
import { regionalRarity } from "./speciesRarityData.js";
import { createGamePresence } from "./gamePresence.js";
import { buildFieldGuide } from "./fieldGuide.js";
import { buildDiscoveries } from "./discoveries.js";
import { flushFootScannedCatalog } from "./footScannedCatalog.js";
import {
  parseStatusJsonDestination,
  parseStatusJsonFootFix,
  parseStatusJsonFuel,
  readStatusJsonFootFixText,
} from "./footTravelStatus.js";
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
  loadPersistedJournalDir,
  persistJournalDirPreference,
  resolveInitialJournalDir,
} from "./journalDirPreference.js";
import {
  buildExoMinimapDto,
  buildExoOrganicOverlayDto,
  ingestExoOrganicJournalLine,
  restoreOrganicSessionFromJournal,
} from "./exoOrganicTracker.js";
import { perfTime, startPerfReporter } from "./perf.js";
import { flushPendingOrganicSampleSession } from "./organicSampleSessionFile.js";
import { fetchEdsmBodiesAsExplorationRecords, searchEdsmSystemsByName } from "./edsmSystemHydration.js";
import { fetchSpanshBodiesAsExplorationRecords, searchSpanshSystemsByName } from "./spanshSystemHydration.js";
import { SessionLog } from "./sessionLog.js";
import {
  backlogMap,
  firstDiscoveryBacklogNow,
  firstDiscoveryBacklogSliced,
  firstDiscoveryBacklogWithDistance,
} from "./firstDiscoveryBacklog.js";
import { galaxySpeciesCatalogue, galaxyValueSearch } from "./galaxyValueSearch.js";
import { galaxyBodyScan, galaxyRegions } from "./galaxyBodyScan.js";
import { loadBioIndex, peekBioIndex } from "./bioIndex.js";
import { importedSystems, loadVisitedImport } from "./visitedCache.js";
import { mySystemDetail, mySystemsDto, sessionRouteDto, visitedSystemsDto } from "./galaxyMine.js";
import { commanderSectorsDto } from "./galaxySectorTiers.js";
import { createUpdateChecker, currentReleaseForm } from "./updateCheck.js";
import { createAppUpdater, resolveUpdateDir } from "./appUpdater.js";
import { createWhatsNew } from "./whatsNew.js";
import { buildDiagnosticsText, installLogRing, loggedLines, serverMemory } from "./diagnostics.js";
import { galaxyMemoryState } from "./galaxyMemory.js";
import { createUnknownExobioLog } from "./exobioUnknown.js";
import { parseHost, parsePort } from "./cliOptions.js";
import type { CliOptions } from "./cliOptions.js";
import { showEdexoNativeFixInfo, logFatal, assertResourceLayout } from "./startupChecks.js";
import { createGggResearch } from "./gggResearch.js";
import { createNoticesService, type CodexFirstFind, type RareColourFind } from "./notices.js";
import { isRareColour } from "../shared/rareColour.js";
import { communityGoalNoticeText, startCommunityGoalPoller } from "./communityGoals.js";
import { startDataAutoRefresh } from "./dataAutoRefresh.js";
import { createBookmarksService } from "./bookmarks.js";
import { spawn } from "node:child_process";
import { createBoxelRun } from "./boxelRun.js";
import { createSavedBoxels } from "./savedBoxels.js";
import { createNeutronLive } from "./neutronLive.js";
import { createNeutronReplanner } from "./neutronReplan.js";
import { createGreenGiantMarks, greenGiantForRecord } from "./greenGiants.js";
import { createNoticesWiring } from "./noticesWiring.js";
import { addSnapshotExtras } from "./snapshotExtras.js";
import { createJournalSideFiles } from "./journalSideFiles.js";
import { createRemoteSystemView } from "./remoteSystemView.js";
import { createStatusReader } from "./appStatus.js";
import type { NotifySettingsDTO } from "../shared/notices.js";
import { readPoiStatus } from "./edastroPoi.js";
import { readCarrierStatus } from "./edastroCarriers.js";
import { fetchGalacticRecords, readGalacticRecordsStatus } from "./galacticRecords.js";
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
import { activeCommander } from "./activeCommander.js";
import { createCommanderWatch } from "./commanderWatch.js";
import { isOtherCommandersJournal } from "./journalCommanders.js";
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
  stagedUpdate: () => { version: string; form: string; file: string; dir: string } | null;
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
  /** A settings setter that writes the settings file after it (audit 2026-10-22: ten copies of the pair). */
  const persisted =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A): void => {
      fn(...a);
      persistUserPreferences();
    };

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
  });
  /*
    A neutron route being flown (plan 8.5, server/neutronLive.ts): its next stop goes to the clipboard after each
    jump onto a stop, the same way; starting one ends the boxel run.
  */
  const neutronLive = createNeutronLive({
    filePath: path.join(resolveCommanderDataDir(), "edexo-neutron-live.json"),
    deliver: (name) => deliverToClipboard(name, "neutron"),
    onStart: () => {
      if (savedBoxels.runId()) savedBoxels.setRun(null);
    },
    onDone: () => neutronStopped(),
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
  const bookmarks = createBookmarksService({
    filePath: path.join(resolveCommanderDataDir(), "edexo-bookmarks.json"),
  });
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
  const notifySettings = (): NotifySettingsDTO => ({
    prefs: notices.prefs(),
    jumpLy: notices.jumpLy(noticesContext),
    poiDataReady: readPoiStatus().haveData,
    carrierDataReady: readCarrierStatus().haveData,
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

  /*
    The codex-first announcement writes the notices file, so it runs with the push, never on a read:
    GET /api/state used to write it too (code review 2026-10-10, A6), the same reason the one-shot
    auto-select moved out of the snapshot.
  */
  const announceCodexFirstIn = (snap: ReturnType<typeof getSnapshot>) => {
    // [CODEX FIRST] candidates (owner, 2026-09-30) and rare colours (1.2.19) in the system he is in go to the bell, once
    // each, and leave it when the body's candidates no longer hold them (owner, 2026-10-04). One walk for both.
    const prefs = notices.prefs();
    if (snap.journalBoot || store.currentSystemAddress == null || (!prefs.codexFirst && !prefs.rareColours)) return;
    const firsts: CodexFirstFind[] = [];
    const rare: RareColourFind[] = [];
    const evaluated = new Set<string>();
    for (const b of snap.bodies ?? []) {
      if (b.state.systemAddress !== store.currentSystemAddress) continue;
      evaluated.add(b.state.key);
      const where = {
        bodyKey: b.state.key,
        systemAddress: b.state.systemAddress,
        system: b.state.starSystem || store.currentSystem || "",
        body: b.tabLabel || b.state.bodyName,
      };
      for (const m of b.matches ?? []) {
        if (m.unlikely) continue;
        const who = { species: m.entry.displayName, speciesId: m.entry.id };
        if (m.codexFirst && m.codexRegion)
          firsts.push({ ...where, ...who, colours: m.codexFirstColours ?? [], region: m.codexRegion });
        for (const r of (m.colourRarity ?? []).filter(isRareColour)) rare.push({ ...r, ...where, ...who });
      }
    }
    const at = new Date().toISOString();
    const changed = [
      prefs.codexFirst && notices.announceCodexFirst(firsts, at, evaluated),
      prefs.rareColours && notices.announceRareColours(rare, at, evaluated),
    ].some(Boolean);
    if (changed) snap.notices = notices.snapshot(store.viewingSystemAddress ?? store.currentSystemAddress ?? null);
  };

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

  /**
   * Coalesce journal-driven pushes: fire at once when idle, then at most one per window while
   * events stream in. At 100 ms a single FSS sweep produced ten full snapshot builds per second.
   */
  const PUSH_WINDOW_MS = 250;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPushAt = 0;
  const pushFlush = () => {
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    lastPushAt = Date.now();
    broadcastSnapshot();
  };
  const push = () => {
    if (pushTimer) return;
    const sinceLast = Date.now() - lastPushAt;
    if (sinceLast >= PUSH_WINDOW_MS) {
      pushFlush();
      return;
    }
    pushTimer = setTimeout(() => {
      pushTimer = null;
      lastPushAt = Date.now();
      broadcastSnapshot();
    }, PUSH_WINDOW_MS - sinceLast);
  };

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

  function createLiveJournalLine(): (line: JournalLine, at: JournalLineAt) => void {
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
        gggResearch.observe(line);
        // Read before apply() closes the run: the tracker files an Analyse under the run's body too.
        const ownLine = store.ownBodyForAnalyse(line);
        achievementWatch.prime();
        store.applyLive(line);
        for (const a of achievementWatch.check()) {
          if (
            notices.announceAchievement(
              { id: a.id, step: a.step, ...achievementNoticeText(a) },
              String(line.timestamp ?? new Date().toISOString()),
            )
          )
            push();
        }
        // Live lines only. The historical replay calls store.apply directly, which is what keeps a
        // first run from asking EDSM about every system the commander has ever visited.
        maybeAutoFetchOnArrival(line);
        canonnUploader.offer(line);
        eddnUploader.offer(line);
        const side = liveSideFiles();
        applyNavRoute(side.route);
        if (line.event === "FSDJump") {
          // A neutron route being flown owns the clipboard; else the boxel run or the saved boxel's next.
          const flying = neutronLive.active();
          const onStop = neutronLive.onJump(shipHere()) != null;
          if (flying && !onStop && neutronLive.offRoute(shipHere())) void neutronReplanner.replan();
          if (!flying) boxelRun.onJump();
          // A run can end on a jump (its last system flown): the HUD line says so.
          if (store.boxelCopied) store.boxelCopied.run = savedBoxels.runId() != null;
        }
        const footFix = side.status ? parseStatusJsonFootFix(side.status) : null;
        ingestExoOrganicJournalLine(store, ownLine, footFix, projectRoot, getCachedSpeciesDatabase());
        sessionLog.record(line, store, getCachedPrices());
        unknownExobio.offer(line);
        backupService.onJournalLine(typeof line.event === "string" ? line.event : undefined);
        gamePresence.onJournalLine(typeof line.event === "string" ? line.event : undefined);
        push();
      } catch (e) {
        console.error("Journal live line failed (skipped line):", e);
      }
    };
  }

  // The journal replay, its cache and the live tail (journalPipeline.ts).
  const journal = createJournalPipeline({
    store,
    projectRoot,
    quietConsole,
    getJournalDir: () => journalDir,
    getJournalListFilterOpts,
    createLiveJournalLine,
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
    // The last finished backlog, never a wait: the map asks for these at start (firstDiscoveryBacklog.ts).
    getMySystems: () =>
      mySystemsDto(
        store,
        backlogMap(store, firstDiscoveryBacklogNow(store)),
        // The game's own visited list (plan 6.1): placed by the galaxy index only if it is already loaded.
        importedSystems(
          loadVisitedImport(),
          new Set([...store.visitedSystems.keys(), ...store.systemPositions.keys()]),
          peekBioIndex(),
        ),
      ),
    getImportedSystems: () =>
      importedSystems(
        loadVisitedImport(),
        new Set([...store.visitedSystems.keys(), ...store.systemPositions.keys()]),
        peekBioIndex(),
      ),
    getMySystem: (addr) =>
      mySystemDetail(store, addr, backlogMap(store, firstDiscoveryBacklogNow(store)), loadBioIndex()),
    getSessionRoute: () => sessionRouteDto(store, sessionLog.toDto().systems),
    getVisitedSystems: (days) => visitedSystemsDto(store, days),
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
    setHudPrefs: persisted((raw) => store.setHudPrefs(raw)),
    setPollRates: (statusMs, journalMs) => applyPollRates(statusMs, journalMs),
    getCollectionFocus: () => loadCollectionFocusConfig(),
    getNotifySettings: notifySettings,
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
    getRecords: () => ({ rows: notices.records(noticesContext), galactic: readGalacticRecordsStatus() }),
    fetchGalacticRecords: async (force) => {
      await fetchGalacticRecords({ force });
      return { rows: notices.records(noticesContext), galactic: readGalacticRecordsStatus() };
    },
    systemPositionOf: (addr) => store.systemPositions.get(addr) ?? null,
    setNotifyPrefs: (raw) => {
      const lowBefore = notices.prefs().codexFirstLowChance;
      notices.setPrefs(raw);
      // The switch changes rows of bodies already computed.
      if (notices.prefs().codexFirstLowChance !== lowBefore)
        setCodexFirstLowChanceKept(() => notices.prefs().codexFirstLowChance ?? true);
      push();
      return notifySettings();
    },
    markNoticesRead: (ids) => {
      const n = notices.markRead(ids);
      if (n) push();
      return n;
    },
    markNoticesUnread: (ids) => {
      const n = notices.markUnread(ids);
      if (n) push();
      return n;
    },
    clearReadNotices: () => {
      const n = notices.clearRead();
      if (n) push();
      return n;
    },
    sendTestNotice: () => {
      notices.sendTest(new Date().toISOString());
      push();
    },
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
    setIncludeBacterium: persisted((v) => store.setIncludeBacteriumInSearch(v)),
    setIncludeExplorationScanData: persisted((v) => store.setIncludeExplorationScanDataInDataValue(v)),
    setPranavAntalBonus: persisted((v) => store.setPranavAntalBonus(v)),
    setSellAtFleetCarrier: persisted((v) => store.setSellAtFleetCarrier(v)),
    setFeederEnabled: persisted((v) => store.setFeederEnabled(v)),
    setFleetCarrierIsOwn: persisted((v) => store.setFleetCarrierIsOwn(v)),
    setFootTravelOdometer: persisted((v) => store.setFootTravelOdometerEnabled(v)),
    setPhotoStamp: persisted((p) => store.setPhotoStamp(p)),
    setExoMapTierThresholds: persisted((plus, pp) => store.setExoMapTierThresholds(plus, pp)),
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
    searchSpanshSystems: (query) => searchSpanshSystemsByName(query),
    hydrateSystemFromEdsm: async (systemAddress, systemName) => {
      const gate = hydrateGate(systemAddress, "EDSM");
      if (gate) return gate;
      const edsm = await fetchEdsmBodiesAsExplorationRecords(
        systemName,
        systemAddress,
        readEdsmCredentials(),
      );
      if (!edsm.ok) return { ok: false, error: edsm.error };
      store.replaceEdsmExplorationForSystem(systemAddress, edsm.records);
      return { ok: true };
    },
    hydrateSystemFromSpansh: async (systemAddress, systemName) => {
      const gate = hydrateGate(systemAddress, "Spansh");
      if (gate) return gate;
      const sp = await fetchSpanshBodiesAsExplorationRecords(systemAddress, systemName);
      if (!sp.ok) return { ok: false, error: sp.error };
      store.replaceEdsmExplorationForSystem(systemAddress, sp.records);
      return { ok: true };
    },
    getEdsmCredentialsStatus: () => edsmCredentialsStatus(),
    setEdsmCredentials: (commanderName, apiKey) => {
      const r = saveEdsmCredentials(commanderName, apiKey);
      if (r.ok) persistUserPreferences();
      return r;
    },
    forgetEdsmCredentials: () => {
      forgetEdsmCredentials();
      // No key, no consent: the toggle goes down with it rather than sitting on waiting for one.
      store.setEdsmAutoFetchEnabled(false);
      persistUserPreferences();
    },
    setEdsmAutoFetchEnabled: (enabled) => {
      if (enabled && !readEdsmCredentials()) {
        return { ok: false, error: "Store your EDSM commander name and API key first." };
      }
      store.setEdsmAutoFetchEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    setEdsmUploadEnabled: (enabled) => {
      if (enabled && !readEdsmCredentials()) {
        return { ok: false, error: "Store your EDSM commander name and API key first." };
      }
      store.setEdsmUploadEnabled(enabled);
      // Switching the upload off takes the live loop with it, the way deleting the key takes
      // auto-fetch down. A "keep sending" left on under a switch that says off is a lie waiting to
      // be believed the next time the upload is turned back on.
      if (!enabled) store.setEdsmLiveUploadEnabled(false);
      persistUserPreferences();
      return { ok: true };
    },
    startEdsmCatchUp: (scope) => uploads.startEdsmRun(scope),
    setEdsmLiveUploadEnabled: (enabled) => {
      if (enabled && !store.edsmUploadEnabled) {
        return { ok: false, error: "Turn EDSM upload on first." };
      }
      store.setEdsmLiveUploadEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    cancelEdsmCatchUp: uploads.cancelEdsmRun,
    setCanonnUploadEnabled: (enabled) => {
      store.setCanonnUploadEnabled(enabled);
      persistUserPreferences();
      // Asked for the first time it is switched on, not at boot: a commander who never turns this
      // on should not cost Canonn a request.
      if (enabled) void canonnUploader.loadWhitelist();
      return { ok: true };
    },
    setEddnUploadEnabled: (enabled) => {
      store.setEddnUploadEnabled(enabled);
      persistUserPreferences();
      return { ok: true };
    },
    scheduleBroadcast: push,
    getEncyclopedia: buildEncyclopediaPayload,
    getFieldGuide: () => buildFieldGuide(projectRoot, getCachedSpeciesDatabase()),
    getEncyclopediaRegion: (name) =>
      Object.fromEntries(
        getCachedSpeciesDatabase().species.map(
          (e) => [e.id, regionalRarity(projectRoot, name, e.id)] as const,
        ),
      ),
    getFeederStatus: () => buildFeederStatus(projectRoot, getCachedSpeciesDatabase()),
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
    startImportDump: importDump.start,
    getImportDumpStatus: importDump.statusFor,
    getEncyclopediaExomastery: (genusDir, speciesEntryId, focusBodyKey) => {
      const entry = findSpeciesEntryForEncyclopedia(genusDir, speciesEntryId);
      if (!entry) return null;
      const fb = focusBodyKey?.trim() || store.uiSelectedBodyKey || null;
      return buildEncyclopediaExomasteryPlanetsPayload(projectRoot, entry, store, fb);
    },
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

      let lastJumpKey: string | null = null;
      const jumpChangedNow = (): boolean => {
        const jt = store.nextJumpTarget();
        const key = jt ? `${jt.source}|${jt.systemAddress}|${jt.starSystem}|${jt.arrived ? 1 : 0}` : "";
        if (key === lastJumpKey) return false;
        lastJumpKey = key;
        return true;
      };
      statusPoller.setTick(() => {
        // Status.json and NavRoute.json are the game's commander's: while that is another commander, not ours (1.3.1).
        if (commanderWatch.gameIsAnotherCommander()) return;
        const navChanged = applyNavRoute(readLiveNavRouteWaypoints());
        const jumpChanged = jumpChangedNow();
        const statusPath = path.join(journalDir, "Status.json");
        let raw: string;
        try {
          raw = readFileSync(statusPath, "utf8");
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
        const read = readStatusJsonFootFixText(raw);
        if (read.kind === "unreadable") return;
        const fix = read.kind === "fix" ? read.fix : null;
        if (fix) {
          store.applyFootTravelSample(fix.latDeg, fix.lonDeg, fix.planetRadiusM, fix.bodyName);
          store.exoOrganicLastFix = fix;
        } else {
          store.exoOrganicLastFix = null;
        }
        // The targeted body: the HUD's candidate list, and a one-shot jump to its Body tab. Pushed
        // only when it actually changes — see `applyStatusDestination`.
        const destChanged = store.applyStatusDestination(parseStatusJsonDestination(raw));
        const fuel = parseStatusJsonFuel(raw);
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
        if (store.exoOrganicTracker || store.overlayTouchdownBodyKey) broadcastExoLive(buildExoLive());

        const footHud = store.footTravelOdometerEnabled && store.footTravelOdometerTracking;
        if (footHud || store.exoOrganicTracker || fuelChanged || navChanged || destChanged || jumpChanged)
          push();
      });
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
        const msg = e instanceof Error ? e.message : String(e);
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
      return st ? { version: st.version, form: st.form, file: st.file, dir: resolveUpdateDir() } : null;
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
