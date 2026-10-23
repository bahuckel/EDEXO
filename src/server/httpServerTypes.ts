/**
 * The options createHttpServer takes and what the route modules read from its scope (moved out of
 * httpServer.ts, audit 2026-10-22: types only, erased at build). The route modules import them from here,
 * so the type-level cycle between httpServer.ts and routes/ is gone; httpServer.ts re-exports them for
 * edexoBootstrap and the tests.
 */
import type { SpanshSystemHit } from "./spanshSystemHydration.js";
import type { GreenGiantVerdict } from "../shared/greenGasGiant.js";
import type { OwnGreenGiant } from "./galaxyLayers.js";
import type { SavedBoxelsService } from "./savedBoxels.js";
import type { Here, NeutronLive } from "./neutronLive.js";
import type { FieldGuideDTO } from "../shared/fieldGuide.js";
import type { RegionalRarity } from "../shared/speciesRarity.js";
import type { EstimatedSurfaceTempBand, PlanetScan, SpeciesMatchContext } from "../shared/types.js";
import type { EncyclopediaCardVerdict } from "../shared/speciesSpawnConditionCards.js";
import type {
  AchievementDetailDTO,
  AchievementsDTO,
  AppSnapshot,
  AppStatusDTO,
  EncyclopediaExomasteryPlanetsResponseDTO,
  EncyclopediaSpeciesRowDTO,
  FeederStatusDTO,
  UpdateDownloadDTO,
  WhatsNewDTO,
  UpdateInfoDTO,
  ImportDumpStatusDTO,
  BacklogMapDTO,
  CommanderSectorsDTO,
  GalaxySpeciesCatalogueDTO,
  GalaxyBodyScanDTO,
  GalaxyBodyScanQueryDTO,
  GalaxyRegionsDTO,
  GalaxyValueQueryDTO,
  GalaxyValueSearchDTO,
  FirstDiscoveryBacklogDTO,
  ExoDataAlertDTO,
  DiscoveriesDTO,
  PhotoStampPrefs,
  GalaxyMineDTO,
  GalaxyMySystemDTO,
  GalaxyRouteDTO,
  GalaxyVisitedDTO,
} from "../shared/types.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import type { GameStateStore } from "./gameState.js";
import type { CollectionFocusConfig } from "./collectionFocus.js";
import type { JournalScan } from "./statisticsScan.js";
import type { PredictionQualityDTO } from "../shared/dto/predictions.js";
import type { EdsmCatchUpScope } from "./edsmCatchUp.js";
import type { BackupService } from "./backupService.js";
import type { BookmarksService } from "./bookmarks.js";
import type { NotifySettingsDTO, RecordRowDTO } from "../shared/notices.js";
import type { GalacticRecordsStatusDTO } from "./galacticRecords.js";
import type { AppView } from "./appViews.js";

export type { AppView } from "./appViews.js";

export interface RecordsDTO {
  rows: RecordRowDTO[];
  galactic: GalacticRecordsStatusDTO;
}

export interface HttpServerOptions {
  port: number;
  bindHost: string;
  /**
   * Shared access key required of every non-loopback client. `null` disables the check, which is
   * correct for a loopback-only bind. See lanAuth.ts.
   */
  lanKey?: string | null;
  getSnapshot: () => AppSnapshot;
  /** The journal folder in use, without building a snapshot for it. */
  getJournalDir?: () => string;
  /** The game's visited list beyond the journals (visitedCache.ts), placed; light — for Find. */
  getImportedSystems?: () => readonly { addr: number; name: string; x: number; y: number; z: number }[];
  /** GET /api/status — launcher-sized status; must not rebuild the snapshot. */
  getStatus: () => AppStatusDTO;
  /** §10.3 — the commander's own coordinates, or null before the first jump this session. */
  getCommanderPosition: () => { x: number; y: number; z: number } | null;
  getCommanderSystem: () => string | null;
  /** GET /api/species-encyclopedia — species rows including exomastery flags */
  getEncyclopedia?: () => EncyclopediaSpeciesRowDTO[];
  /** GET /api/field-guide — published conditions + measured charts per species (shared/fieldGuide.ts). */
  getFieldGuide?: () => FieldGuideDTO;
  /** GET /api/encyclopedia-region?name= — every species' rarity in one region (null = no data). */
  getEncyclopediaRegion?: (name: string) => Record<string, RegionalRarity | null>;
  /** POST /api/encyclopedia/card-verdicts — the matcher's grade of every species' condition cards on a body (plan 1.10). */
  getCardVerdicts?: (
    scan: PlanetScan,
    est: EstimatedSurfaceTempBand | null,
    ctx: SpeciesMatchContext | null,
  ) => Record<string, Record<string, EncyclopediaCardVerdict>>;
  /**
   * GET /api/first-discovery-backlog — biology left uncollected in systems this commander found.
   *
   * Its own endpoint rather than a snapshot field because it costs ~15 s over this commander's
   * history, and the snapshot rebuilds on every journal line. Absent on a build with no store
   * behind it, in which case the panel hides itself.
   */
  getFirstDiscoveryBacklog?: () => FirstDiscoveryBacklogDTO | Promise<FirstDiscoveryBacklogDTO>;
  /** GET /api/backlog-map — the same backlog rolled up to placed systems, for the galaxy map. */
  getBacklogMap?: () => BacklogMapDTO | Promise<BacklogMapDTO>;
  /** Everything scanned, for the "My discoveries" panel. Built on request; see discoveries.ts. */
  getDiscoveries?: () => DiscoveriesDTO;
  /**
   * GET /api/galaxy/worth — systems the codex says hold a species worth at least `minCr`.
   *
   * Absent on a build with no galaxy index, which is every install until the index ships; the caller
   * hides the control rather than showing an empty answer.
   */
  searchGalaxyByValue?: (query: GalaxyValueQueryDTO, limit: number) => GalaxyValueSearchDTO;
  /** GET /api/galaxy/species — what the genus/species picker can offer, with per-species coverage. */
  getGalaxySpecies?: () => GalaxySpeciesCatalogueDTO;
  /**
   * GET /api/galaxy/regions — the regions the body file holds, for the predicted search's picker.
   *
   * Absent on a build with no body file, which is every install but the one that built it; the
   * panel hides the whole predicted mode rather than offering a picker with nothing behind it.
   */
  getGalaxyRegions?: () => GalaxyRegionsDTO;
  /**
   * GET /api/galaxy/possible — bodies whose conditions suit a species, in systems nobody has walked.
   *
   * Async because it is seconds of work, not milliseconds: a region is up to 3.2 M bodies and the
   * scan yields to the event loop as it goes so the journal watcher keeps running underneath it.
   */
  scanGalaxyBodies?: (query: GalaxyBodyScanQueryDTO, limit: number) => Promise<GalaxyBodyScanDTO>;
  /** GET /api/galaxy/my-sectors — this commander's own state per sector, for colouring the map. */
  getCommanderSectors?: () => CommanderSectorsDTO;
  /** The 3D map's "your systems" layer, its detail panel, and this session's route (galaxyMine.ts). */
  getMySystems?: () => GalaxyMineDTO;
  getMySystem?: (addr: number) => GalaxyMySystemDTO | null;
  getSessionRoute?: () => GalaxyRouteDTO;
  getVisitedSystems?: (days: number) => GalaxyVisitedDTO;
  /** The journal store itself, for the map's Find box (the commander's own system names). */
  getJournalStore?: () => GameStateStore;
  /** Codex map: the commander's codex entries, `regionJoinKey|entryKey` (see codexMap.ts). */
  getCodexMapLogged?: () => ReadonlySet<string>;
  /** Achievements: the list, one set's entries, and which one is tracked (false = no such id). */
  getAchievements?: () => AchievementsDTO;
  getAchievementDetail?: (id: string) => AchievementDetailDTO | null;
  trackAchievement?: (id: string | null) => boolean;
  /**
   * GET /api/feeder/status — feeder corpus vs installed profiles.
   *
   * Absent on a build with no feeder corpus, which is every normal install; the panel hides itself
   * rather than showing empty numbers.
   */
  getFeederStatus?: () => Promise<FeederStatusDTO>;
  /** GET /api/app/update (`?force=1` asks GitHub again) — running version vs newest release. */
  getUpdateInfo?: (force: boolean) => Promise<UpdateInfoDTO>;
  /**
   * POST /api/app/open-update — open the newer release's page in the system browser. No URL is
   * taken from the caller; the server opens the page it found itself, on github.com, or nothing.
   */
  openUpdatePage?: () => { ok: boolean; error?: string };
  /**
   * POST /api/app/update/download — download the newer release for an install on restart
   * (appUpdater.ts). Answers at once with the status; GET /api/app/update carries the progress.
   */
  startUpdateDownload?: () => UpdateDownloadDTO;
  /**
   * GET /api/app/whats-new (`?any=1`: this version's notes even when seen) and POST
   * /api/app/whats-new/seen — the launcher's notes after an update (whatsNew.ts).
   */
  getWhatsNew?: (any: boolean) => Promise<WhatsNewDTO>;
  markWhatsNewSeen?: () => void;
  /** GET /api/app/diagnostics — Options' Copy diagnostics, plain text with nothing private (diagnostics.ts). */
  getDiagnostics?: () => Promise<string>;
  /**
   * POST /api/feeder/import-dump — start a Spansh JSONL export import into the feeder corpus
   * (`{ file, apply }`); GET /api/feeder/import-dump/status — its progress and last report.
   * Absent on a build with no feeder corpus.
   */
  startImportDump?: (file: string, apply: boolean) => { ok: boolean; error?: string };
  getImportDumpStatus?: (file?: string | null) => ImportDumpStatusDTO;
  /** POST /api/settings/include-bacterium */
  /** POST /api/settings/hud-prefs */
  setHudPrefs?: (raw: unknown) => void;
  /**
   * POST /api/settings/poll-rates — JSON `{ statusPollMs, journalPollMs }`.
   *
   * Applied to the running timers, not queued for the next launch: that is the entire request. The
   * implementation clamps, so the reply is the accepted pair and the launcher shows that rather
   * than what it sent.
   */
  setPollRates?: (
    statusPollMs: unknown,
    journalPollMs: unknown,
  ) => { statusPollMs: number; journalPollMs: number };
  /**
   * POST /api/settings/radar-radius — JSON `{ radiusM }`. Returns the accepted (clamped) value.
   *
   * Applied to the live radar, not queued: the commander changing this is looking at the thing it
   * changes.
   */
  setRadarRadiusM?: (radiusM: unknown) => number;
  /**
   * GET/POST `/api/settings/collection-focus` — the thresholds behind the ⌖ mark.
   *
   * Local-only state (`edexo-collection-focus.json` beside the user settings), so it is read back
   * from the server rather than mirrored into the snapshot: it changes when somebody edits it and
   * at no other time, and the snapshot is already the biggest thing on the wire.
   */
  getCollectionFocus?: () => CollectionFocusConfig;
  /** GET/POST `/api/settings/notify` — the "Notify me" toggles and what the radius works out to (shared/notices.ts). */
  getNotifySettings?: () => NotifySettingsDTO;
  /** GET `/api/records` — every type's records, his and EDAstro's (Statistics → Records). */
  getRecords?: () => RecordsDTO;
  /** POST `/api/records/fetch-galactic` — download EDAstro's records pages (galacticRecords.ts). */
  fetchGalacticRecords?: (force: boolean) => Promise<RecordsDTO>;
  /** The commander's bookmarks (`/api/bookmarks`, server/bookmarks.ts). */
  bookmarks?: BookmarksService;
  /**
   * The commander's green gas giant call on a scanned body (`/api/ggg/mark`, server/greenGiants.ts).
   * Returns the body's verdict after the call, or false when there is no scan of that body.
   */
  setGreenGiantMark?: (
    systemAddress: number,
    bodyId: number,
    mark: "yes" | "no" | null,
  ) => GreenGiantVerdict | null | false;
  /** Boxels the commander is scanning (`/api/boxels`, server/savedBoxels.ts). */
  savedBoxels?: SavedBoxelsService;
  /** The neutron route being flown (`/api/neutron/live`, server/neutronLive.ts), and where the ship is. */
  neutronLive?: NeutronLive;
  shipHere?: () => Here;
  /** The route being flown was stopped: what it put on the HUD goes too. */
  onNeutronStopped?: () => void;
  /** Green gas giants the commander confirmed that edGGG does not list, for the galaxy map's layer. */
  ownGreenGiants?: () => readonly OwnGreenGiant[];
  /** Where a system is, from the journals' StarPos, for a new bookmark. */
  systemPositionOf?: (systemAddress: number) => { x: number; y: number; z: number } | null;
  setNotifyPrefs?: (raw: unknown) => NotifySettingsDTO;
  /** POST `/api/notices/read` — `{ ids: string[] }` or `{ all: true }`; returns how many changed. */
  markNoticesRead?: (ids: readonly string[] | "all") => number;
  /** POST `/api/notices/unread` — `{ ids: string[] }`. */
  markNoticesUnread?: (ids: readonly string[]) => number;
  /** POST `/api/notices/clear-read` — deletes the read ones. */
  clearReadNotices?: () => number;
  /** POST `/api/notices/test` — one test notice (Options → Notify me). */
  sendTestNotice?: () => void;
  setCollectionFocus?: (raw: unknown) => CollectionFocusConfig;
  setIncludeBacterium?: (value: boolean) => void;
  setIncludeExplorationScanData?: (value: boolean) => void;
  /** POST /api/settings/pranav-antal-bonus — `{ value: boolean }`. */
  setPranavAntalBonus?: (value: boolean) => void;
  setSellAtFleetCarrier?: (value: boolean) => void;
  /** POST /api/settings/feeder: `{ value: boolean }`, the data feeder's entries shown (off by default). */
  setFeederEnabled?: (value: boolean) => void;
  /** POST /api/settings/fleet-carrier-own: `{ value: boolean }`, the carrier is his own (-15 %). */
  setFleetCarrierIsOwn?: (value: boolean) => void;
  /** POST /api/settings/photo-stamp — JSON { commander?, system?, timestamp?: boolean } */
  setPhotoStamp?: (p: Partial<PhotoStampPrefs>) => void;
  /** POST /api/settings/foot-travel-odometer — JSON { value: boolean } */
  setFootTravelOdometer?: (value: boolean) => void;
  /** POST /api/settings/exo-map-tiers — JSON { plusMinCr: number, plusPlusMinCr: number } */
  setExoMapTierThresholds?: (plusMinCr: number, plusPlusMinCr: number) => void;
  /**
   * POST /api/ui/open-external — open one of this app's own views in the system browser.
   *
   * The launcher's "Open exobiology UI" used to navigate the launcher window itself, which is the
   * one place the commander cannot get back from. The owner asked for a choice, with the browser
   * as the default.
   *
   * The view is an **enum, not a URL**. The server builds the address from its own port, so this
   * can never be talked into launching something else — a route that takes a URL and hands it to
   * the shell is an open redirect with a browser on the end of it.
   *
   * Loopback only, for the same reason as the miss log: the window opens on the PC running the
   * app, so a phone pressing this would open something on a screen it cannot see.
   */
  openAppView?: (view: AppView) => { ok: boolean; error?: string };
  /**
   * POST /api/settings/open-miss-log — hand `edexo-outliers.jsonl` to the desktop.
   *
   * **Loopback only**, and not because the file is a secret to the commander: it is *their* miss log
   * and it never leaves the machine. The point is that the window that opens would open on the PC
   * running the app, so a phone on the LAN pressing this would make a window appear on a screen it
   * cannot see and cannot close. The route refuses rather than doing that.
   */
  openExoMissLog?: () => { ok: boolean; error?: string };
  /** POST /api/exobiology/reset with confirm: true */
  resetExobiology?: () => void;
  /** POST /api/system/hydrate-from-edsm — JSON { systemAddress: number, systemName: string } (known systems only). */
  hydrateSystemFromEdsm?: (
    systemAddress: number,
    systemName: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** GET /api/settings/edsm-credentials — commander name + whether a key is stored. Never the key. */
  getEdsmCredentialsStatus?: () => { commanderName: string | null; hasKey: boolean; keyHint: string | null };
  /** POST /api/settings/edsm-credentials — JSON { commanderName, apiKey }. */
  setEdsmCredentials?: (commanderName: string, apiKey: string) => { ok: boolean; error?: string };
  /** DELETE /api/settings/edsm-credentials — also switches auto-fetch off. */
  forgetEdsmCredentials?: () => void;
  /** POST /api/settings/edsm-auto-fetch — JSON { enabled }. Refused without stored credentials. */
  setEdsmAutoFetchEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** POST /api/settings/canonn-upload — JSON { enabled }. The switch is the whole consent. */
  setCanonnUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** POST /api/settings/eddn-upload — JSON { enabled }. The switch is the whole consent. */
  setEddnUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** GET /api/system/edsm-search?q= — galaxy name prefix via EDSM (returns id64 as systemAddress). */
  searchEdsmSystems?: (
    query: string,
  ) => Promise<
    { ok: true; systems: { systemAddress: number; starSystem: string }[] } | { ok: false; error: string }
  >;
  /** GET /api/system/spansh-search?q= — the same shape from Spansh (id64 = SystemAddress). */
  searchSpanshSystems?: (
    query: string,
  ) => Promise<{ ok: true; systems: SpanshSystemHit[] } | { ok: false; error: string }>;
  /**
   * The statistics scan: three years of journals reduced to totals.
   *
   * A callback rather than a path, because the http layer has no business listing the commander's
   * journal folder — the bootstrap already knows where it is and which files count.
   */
  getStatisticsScan?: () => Promise<JournalScan>;
  /** GET /api/predictions/quality — the prediction log scored (plan 1.9, predictionQuality.ts). */
  getPredictionQuality?: () => PredictionQualityDTO;
  /** POST /api/system/hydrate-from-spansh — bodies from Spansh's dump for a system the journal never scanned. */
  hydrateSystemFromSpansh?: (
    systemAddress: number,
    systemName: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** POST /api/ui/view-system — JSON { systemAddress: number | null, starSystem?: string } */
  setViewingSystem?: (systemAddress: number | null) => void;
  /** Optional: remember system name when client provides it (journal row or EDSM pick). */
  rememberVisitedSystem?: (starSystem: string, systemAddress: number) => void;
  /**
   * A system chosen from the header search: when the journals know nothing about it, fetch it from
   * Spansh (cache first, 30 days) — see `remoteSystems.ts`. Replaces writing the pasted name into the
   * visited-systems list, which put systems he had never flown to into "My discoveries".
   */
  lookupSystem?: (systemAddress: number, starSystem: string) => void;
  /** POST /api/ui/selected-body — JSON { bodyKey: string | null } */
  setUiSelectedBodyKey?: (bodyKey: string | null) => boolean | void;
  /** Switch the main window's body tab to this body (a notice's or bookmark's Show; 1.2.19). */
  focusUiBody?: (bodyKey: string) => void;
  /** POST /api/settings/journal-directory — JSON { journalDir: string } */
  setJournalDirectory?: (dir: string) => Promise<{ ok: boolean; error?: string }>;
  /** POST /api/settings/journal-history — JSON { preset: JournalHistoryPreset } */
  setJournalHistoryPreset?: (preset: JournalHistoryPreset) => Promise<void>;
  /** POST /api/settings/edsm-upload — JSON { enabled }. Refused without stored credentials. */
  setEdsmUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** Kick off a catch-up. Refused when one is already running or the switch is off. */
  startEdsmCatchUp?: (scope: EdsmCatchUpScope) => { ok: boolean; error?: string };
  cancelEdsmCatchUp?: () => void;
  /** POST /api/settings/edsm-live-upload — JSON { enabled }. Refused unless upload is on. */
  setEdsmLiveUploadEnabled?: (enabled: boolean) => { ok: boolean; error?: string };
  /** After mutating server state, refresh WebSocket clients (e.g. debounced push). */
  scheduleBroadcast?: () => void;
  /** GET /api/encyclopedia-exomastery/:genusDir/:speciesEntryId — feeder profile or per-body EDSM rows. */
  getEncyclopediaExomastery?: (
    genusDir: string,
    speciesEntryId: string,
    focusBodyKey?: string | null,
  ) => EncyclopediaExomasteryPlanetsResponseDTO | null;
  /** POST /api/exomastery/reload — re-read species DB + clear exomastery JSON cache; then call {@link scheduleBroadcast}. */
  reloadExomastery?: () => void;
  /** The commander's own exomastery (on-foot finds) or codex record, as a download (§S). */
  exportExomastery?: (kind: "exomastery" | "codex") => { fileName: string; body: unknown };
  /** The launcher's Backups row (backupService.ts); absent where backups are not wired. */
  backup?: BackupService;
  /** Clear in-memory exomastery JSON cache only (used by encyclopedia `?force=1`). */
  clearExomasteryProfileCache?: () => void;
  /** POST /api/exo-data-alerts/fix — write fixes_*.json stubs next to codex / feeder JSON. */
  writeExoDataAlertFix?: (alert: ExoDataAlertDTO) => {
    ok: boolean;
    written?: { root: string; relativePath: string; absolutePath: string }[];
    error?: string;
  };
  /** When set (e.g. Electron main process), successful Fix can show a native dialog instead of the browser. */
  showFixStubNativeDialog?: (message: string) => boolean;
}

/** What the route modules read from the server's own scope. */
export interface RouteContext {
  root: string;
  webRoot: string;
  /** An event to every Colonize window (`colonize` sockets), as `{ type: "colonize", event, payload }`. */
  pushColonize: (event: string, payload: unknown) => void;
}
