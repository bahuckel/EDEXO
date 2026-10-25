import { getColonizeHud } from "./colonize/hudSummary";
import { commanderIdHash, setOwnCommander } from "./sharedExomastery.js";
import type { SessionLogDTO } from "../shared/types.js";
import { existsSync, statSync } from "node:fs";
import { loadSpatialCatalogue } from "./spatialCatalogue.js";
import type { AppSnapshot, BodyComputed, JournalBootProgressDTO } from "../shared/types.js";
import { getProjectRoot } from "./paths.js";
import { perfTime } from "./perf.js";
import { buildShipProximity } from "./shipProximity.js";
import { regionForSystem, regionIndexForSystem } from "./regionMapData.js";
import type { GameStateStore } from "./gameState.js";
import { shownSpeciesMatches } from "./matchSpecies.js";
import { explorationDataValueBreakdown } from "./explorationDataEstimate.js";
import {
  buildPrimaryStarsHeader,
  buildSystemMapSnapshot,
  explorationRecordsForSystem,
  bodyHasExoMarkers,
  loadStarRolesConfig,
  type ExoMatchRun,
} from "./systemMap.js";
import { ownFootEntriesWithBackups } from "./footScannedCatalog.js";
import { buildExoMinimapDto, buildExoOrganicOverlayDto } from "./exoOrganicTracker.js";
import { timingFromSamples } from "../shared/systemTriage.js";
import { exoOutlierTally } from "./exoOutlierLog.js";
import { edsmUploadLedgerSummary } from "./edsmUploadLedger.js";
import { edsmCredentialsStatus } from "./edsmCredentials.js";
import { autoScanOnlyBodies } from "./autoScanOnly.js";
import {
  firstFootfallLookupFor,
  buildJournalSystems,
  resolveViewingSystemName,
  buildRemoteView,
  buildDScanBodiesSnapshot,
  buildLiveShipFuelRangeDTO,
  buildNotableBodiesForFocusedSystem,
} from "./snapshotSystemInfo.js";
import { bodyKey } from "../shared/bodyKey.js";
// The unsold exobiology's value moved to organicValue.ts (item 30); the live strip is still importable from here.
export { organicLiveSummary } from "./organicValue.js";
import {
  buildOrganicPendingLines,
  FLEET_CARRIER_SALE_FACTOR,
  organicDataValuation,
  OWN_FLEET_CARRIER_SALE_FACTOR,
} from "./organicValue.js";
// One body's candidates moved to bodyCompute.ts (item 30); what others import is still importable from here.
export * from "./bodyCompute.js";
import {
  buildSharedExomasterySummary,
  computeAutoScanOnlyBody,
  computeBody,
  sweepColourOutliers,
  syncRarity,
  trackedAchievementForSnapshot,
} from "./bodyCompute.js";
// The species database moved to speciesDb.ts (item 30); still importable from here.
export { loadSpeciesDatabase, getCachedPrices, getCachedSpeciesDatabase, getCachedPriceIndex, clearEncyclopediaPayloadCache, buildEncyclopediaPayload, findSpeciesEntryForEncyclopedia } from "./speciesDb.js";
import { getCachedPrices, getCachedSpeciesDatabase, loadSpeciesDatabase } from "./speciesDb.js";
export { PRESENCE_FLOOR_PCT, demoteBelowPresenceFloor, GENUS_SHARE_FLOOR_PCT } from "./presenceFloors.js";

/**
 * Attach the first-footfall verdict to the next-jump card.
 *
 * Skipped once `arrived` is true: the commander is there, the journal's own `WasDiscovered` on the
 * arrival star is the better source, and a guess from EDSM would overwrite a fact with an opinion.
 */
function withFirstFootfall(
  jt: NonNullable<AppSnapshot["jumpTarget"]> | null,
  store: {
    hasVisitedSystemNamed: (name: string) => boolean;
    commanderDiscoveredSystem: (systemAddress: number) => boolean | null;
  },
): NonNullable<AppSnapshot["jumpTarget"]> | null {
  if (!jt || jt.arrived || !jt.starSystem) return jt;
  const lookup = firstFootfallLookupFor(store);
  lookup.request([jt.starSystem]);
  return {
    ...jt,
    likelyFirstFootfall: lookup.verdict(jt.starSystem),
    // The Next jump card's "Discovered by you" (owner, 2026-10-06): your journals say you were first.
    discoveredByYou: jt.systemAddress ? store.commanderDiscoveredSystem(jt.systemAddress) === true : false,
  };
}

let cachedStarRoles: ReturnType<typeof loadStarRolesConfig> | null = null;

/**
 * The region under the system being looked at.
 *
 * Cheap: one `Map` lookup for the coordinates and one run-length walk across a 2 048-entry row. It
 * runs once per snapshot, not once per body, which is the difference between free and the kind of
 * cost that ends up in a CPU profile.
 */
function regionForFocusedSystem(
  store: GameStateStore,
  focusAddr: number | null,
  projectRoot: string,
): { name: string; index: number } | null {
  if (focusAddr == null) return null;
  const pos = store.systemPositions.get(focusAddr);
  if (!pos) return null;
  const index = regionIndexForSystem(projectRoot, pos.x, pos.z);
  if (index == null || index <= 0) return null;
  const name = regionForSystem(projectRoot, pos.x, pos.y, pos.z);
  return name ? { name, index } : null;
}

export function buildSnapshot(
  store: GameStateStore,
  journalPath: string | null,
  journalDir: string,
  bindHost: string,
  port: number,
  lanUrls: string[],
  journalFileCount: number,
  journalBoot: JournalBootProgressDTO | null = null,
  sessionLog: SessionLogDTO | null = null,
): AppSnapshot {
  const bootLoading = journalBoot != null;
  const db = getCachedSpeciesDatabase();
  // Whose shared-exomastery files are this commander's own backups (§S), before any body is computed.
  setOwnCommander({ name: store.commanderName, fid: commanderIdHash(store.commanderFid) });
  if (!bootLoading) syncRarity(store, db);
  /*
    Not while the history replays (plan 2.3, Opus 20): every progress push walked every scan and every
    sample of a store that changes between pushes, so the memo never held — for totals the boot screen
    covers. Zero until the replay is done.
  */
  const { credits: organicDataValueCredits, pendingSamples: organicPendingSampleCount } = bootLoading
    ? { credits: 0, pendingSamples: 0 }
    : organicDataValuation(store, getCachedPrices());
  // One walk of every scan, not two: the total is the breakdown's own total (code review §E).
  const exploreRaw = bootLoading
    ? { totalCredits: 0, fssScanCount: 0, fssValueCredits: 0, dssScanCount: 0, dssValueCredits: 0 }
    : explorationDataValueBreakdown(store);
  // Sold at a fleet carrier, the carrier keeps 25 % (the Data value toggle; owner, 2026-10-03).
  const carrier = !store.sellAtFleetCarrier
    ? 1
    : store.fleetCarrierIsOwn
      ? OWN_FLEET_CARRIER_SALE_FACTOR
      : FLEET_CARRIER_SALE_FACTOR;
  const exploreBreakdown = {
    ...exploreRaw,
    fssValueCredits: Math.round(exploreRaw.fssValueCredits * carrier),
    dssValueCredits: Math.round(exploreRaw.dssValueCredits * carrier),
    totalCredits:
      Math.round(exploreRaw.fssValueCredits * carrier) + Math.round(exploreRaw.dssValueCredits * carrier),
  };
  const explorationScanDataValueCredits = exploreBreakdown.totalCredits;
  const organicPendingLines = bootLoading ? [] : buildOrganicPendingLines(store, db, getCachedPrices());
  // Logged colours anywhere in the journals, not only in the system in view (see the function).
  if (!bootLoading) perfTime("snap.colourSweep", () => sweepColourOutliers(store, db));
  const bodies: BodyComputed[] = bootLoading
    ? []
    : perfTime("snap.bodies", () =>
        store
          .listBioBodies()
          .sort((a, b) => a.bodyId - b.bodyId)
          .map((b) => computeBody(b, db, getCachedPrices(), store)),
      );

  /*
    The map's species for a body are the tab's (buildSystemMapSnapshot `tabRuns`): only where the map would have run
    the chain itself — a body with exo markers whose scan names a planet class — and before the AutoScan-only rows
    below, which the map does not list.
  */
  const tabRuns = new Map<string, ExoMatchRun>();
  for (const c of bodies) {
    const scan = c.mergedScan;
    if (!scan?.PlanetClass?.trim() || !bodyHasExoMarkers(c.state)) continue;
    tabRuns.set(bodyKey(c.state.systemAddress, c.state.bodyId), {
      exo: c.state,
      scan,
      matches: c.matches,
      shown: shownSpeciesMatches(c.matches),
      approximateMatchingUsed: c.approximateMatchingUsed,
    });
  }

  const focusAddr = store.viewingSystemAddress ?? store.currentSystemAddress;
  const fssAllBodiesFoundNoBio = bootLoading
    ? false
    : focusAddr != null && store.fssAllBodiesCompleteSystems.has(focusAddr) && bodies.length === 0;
  // Landable bodies the ship only AutoScanned: their biology is unknown until the FSS (autoScanOnly.ts).
  if (!bootLoading && focusAddr != null && !store.isShowingRemoteSystem(focusAddr)) {
    for (const b of autoScanOnlyBodies(store, focusAddr)) {
      const c = computeAutoScanOnlyBody(b, store, db, getCachedPrices());
      if (c) bodies.push(c);
    }
  }

  const journalSystems = bootLoading ? [] : perfTime("snap.journalSystems", () => buildJournalSystems(store));
  const viewingSystemName = bootLoading ? null : resolveViewingSystemName(store, store.viewingSystemAddress);
  const dScanNameFallback =
    bootLoading || focusAddr == null ? null : resolveViewingSystemName(store, focusAddr);

  const projectRoot = getProjectRoot();
  if (!cachedStarRoles) {
    try {
      cachedStarRoles = loadStarRolesConfig(projectRoot);
    } catch {
      cachedStarRoles = {
        fuelPrefixes: ["O", "B", "A", "F", "G", "K", "M"],
        neutronExact: ["N"],
        blackHoleExact: ["H"],
        whiteDwarfPrefix: "D",
      };
    }
  }

  const systemMap =
    bootLoading || focusAddr == null
      ? null
      : perfTime("snap.systemMap", () =>
          buildSystemMapSnapshot(
            store,
            focusAddr,
            db,
            cachedStarRoles!,
            getCachedPrices(),
            loadSpatialCatalogue(projectRoot),
            tabRuns,
          ),
        );
  const dScanBodies = bootLoading
    ? null
    : buildDScanBodiesSnapshot(store, focusAddr, dScanNameFallback, systemMap);

  // Sold rows count here too — see `explorationRecordsForSystem`. The star header is what the system
  // map button hangs off, so losing it to a sale takes the map with it.
  const recsForPrimary =
    !bootLoading && focusAddr != null ? explorationRecordsForSystem(store, focusAddr) : [];
  const primaryStarsHeader =
    !bootLoading && recsForPrimary.length > 0
      ? buildPrimaryStarsHeader(recsForPrimary, cachedStarRoles)
      : null;

  const edsmMapSupplementForViewingSystem =
    !bootLoading &&
    focusAddr != null &&
    store.hasEdsmExplorationForSystem(focusAddr) &&
    !store.hasJournalExplorationScansForSystem(focusAddr);

  const footScannedEntries = bootLoading
    ? []
    : perfTime("snap.footCatalog", () =>
        ownFootEntriesWithBackups(projectRoot).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
      );

  const notableBodies = bootLoading
    ? []
    : perfTime("snap.notable", () => buildNotableBodiesForFocusedSystem(store, dScanNameFallback));
  const uiAutoSelectBodyKey = bootLoading ? null : store.peekPendingUiAutoSelectBodyKey();
  const exoOverlayFocusBodyKey =
    bootLoading || focusAddr == null ? null : store.resolveExoOverlayFocusBodyKey();
  let exoOverlayFocusBody: BodyComputed | null = null;
  if (!bootLoading && exoOverlayFocusBodyKey && focusAddr != null) {
    const raw = store.bodies.get(exoOverlayFocusBodyKey);
    if (
      raw &&
      raw.systemAddress === focusAddr &&
      !bodies.some((b) => b.state.key === exoOverlayFocusBodyKey)
    ) {
      exoOverlayFocusBody = computeBody(raw, db, getCachedPrices(), store);
    }
  }

  let journalDirConfiguredOk = false;
  try {
    journalDirConfiguredOk = existsSync(journalDir) && statSync(journalDir).isDirectory();
  } catch {
    journalDirConfiguredOk = false;
  }

  return {
    journalPath,
    journalFileCount,
    journalDir,
    journalDirConfiguredOk,
    journalHistoryPreset: store.journalHistoryPreset,
    edsmMapSupplementForViewingSystem,
    journalBoot,
    mode: bindHost === "0.0.0.0" ? "server" : "client",
    bindHost,
    port,
    lanUrls,
    commanderName: store.commanderName,
    currentSystem: store.currentSystem,
    currentSystemAddress: store.currentSystemAddress,
    currentRegion: regionForFocusedSystem(store, focusAddr, projectRoot),
    shipRegion:
      store.currentSystemAddress === focusAddr
        ? regionForFocusedSystem(store, focusAddr, projectRoot)
        : regionForFocusedSystem(store, store.currentSystemAddress, projectRoot),
    currentSystemKind: focusAddr != null ? store.systemKind(focusAddr) : null,
    viewingSystemAddress: store.viewingSystemAddress,
    viewingSystemName,
    remoteView: bootLoading ? null : buildRemoteView(store),
    sharedExomastery: bootLoading ? null : buildSharedExomasterySummary(db),
    shipProximity: bootLoading
      ? null
      : buildShipProximity(store.currentBodyKey, focusAddr, recsForPrimary, bodies),
    journalSystems,
    bodies,
    speciesCount: db.species.length,
    lastJournalEventIso: store.lastEventIso,
    organicDataValueCredits,
    colonizeHud: getColonizeHud(),
    shipDamage: store.shipDamage.loadoutAt ? store.shipDamage : null,
    organicPendingSampleCount,
    organicPendingLines,
    fssAllBodiesFoundNoBio,
    includeBacteriumInSearch: store.includeBacteriumInSearch,
    hudPrefs: store.hudPrefs,
    trackedAchievement: bootLoading ? null : trackedAchievementForSnapshot(store, bodies),
    sessionLog,
    canonnUpload: {
      enabled: store.canonnUploadEnabled,
      sent: store.canonnUploadSent,
      failed: store.canonnUploadFailed,
    },
    eddnUpload: {
      enabled: store.eddnUploadEnabled,
      sent: store.eddnUploadSent,
      failed: store.eddnUploadFailed,
    },
    edsmAutoFetch: {
      enabled: store.edsmAutoFetchEnabled,
      ...edsmCredentialsStatus(),
    },
    edsmUpload: {
      enabled: store.edsmUploadEnabled,
      live: store.edsmLiveUploadEnabled,
      progress: store.edsmUploadProgress,
      ledger: edsmUploadLedgerSummary(),
    },
    includeExplorationScanDataInDataValue: store.includeExplorationScanDataInDataValue,
    pranavAntalBonus: store.pranavAntalBonus,
    sellAtFleetCarrier: store.sellAtFleetCarrier,
    fleetCarrierIsOwn: store.fleetCarrierIsOwn,
    feederEnabled: store.feederEnabled,
    explorationScanDataValueCredits,
    explorationFssScanCount: exploreBreakdown.fssScanCount,
    onSiteTiming: timingFromSamples(store.landingMinutesSamples, store.samplingMinutesSamples),
    exoOutliers: exoOutlierTally(),
    explorationFssValueCredits: exploreBreakdown.fssValueCredits,
    explorationHonkValueCredits: Math.round(
      ("honkValueCredits" in exploreRaw ? exploreRaw.honkValueCredits : 0) * carrier,
    ),
    explorationDssScanCount: exploreBreakdown.dssScanCount,
    explorationDssValueCredits: exploreBreakdown.dssValueCredits,
    dssMappedPlanetaryBodyCount: exploreBreakdown.dssScanCount,
    notableBodies,
    exoMapTierPlusMinCr: store.exoMapTierPlusMinCr,
    exoMapTierPlusPlusMinCr: store.exoMapTierPlusPlusMinCr,
    dScanBodies,
    primaryStarsHeader,
    systemMap,
    footScannedEntries,
    uiAutoSelectBodyKey,
    uiSelectedBodyKey: bootLoading ? null : store.uiSelectedBodyKey,
    exoOverlayFocusBodyKey,
    exoOverlayFocusBody,
    statusDestination: bootLoading ? null : store.statusDestination,
    jumpTarget: bootLoading ? null : withFirstFootfall(store.nextJumpTarget(), store),
    boxelCopied: store.boxelCopied,
    boxelsRevision: store.boxelsRevision,
    focusedSystemUndiscovered:
      !bootLoading && focusAddr != null && store.commanderDiscoveredSystem(focusAddr) === true,
    remainingJumpsInRoute: bootLoading ? null : store.remainingJumpsInRoute,
    liveShipFuelRange: bootLoading ? null : buildLiveShipFuelRangeDTO(store, cachedStarRoles!),
    footTravelOdometerEnabled: store.footTravelOdometerEnabled,
    photoStamp: store.photoStamp,
    footTravelOdometerTracking: bootLoading ? false : store.footTravelOdometerTracking,
    footTravelDistanceMeters: bootLoading ? 0 : store.footTravelDistanceMeters,
    exoOrganicOverlay: bootLoading ? null : buildExoOrganicOverlayDto(store, getCachedPrices()),
    /*
      The radar rides on the snapshot separately from the sample session.

      It used to live only inside `exoOrganicOverlay`, which is null until a species is being
      tracked — so landing on a planet and looking at the overlay showed nothing, which is what the
      owner reported. Where the ship is parked and which plants are already taken is a question
      about the body underfoot, and it has an answer the moment the game reports a surface position.
    */
    exoMinimap: bootLoading
      ? null
      : buildExoMinimapDto(
          store,
          store.exoOrganicTracker?.bodyKey ?? store.overlayTouchdownBodyKey,
          store.exoOrganicTracker ? Math.max(0, Math.round(store.exoOrganicTracker.minSampleDistanceM)) : 0,
        ),
  };
}

loadSpeciesDatabase();
