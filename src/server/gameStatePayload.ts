/*
  The journal cache's payload (split out of gameState.ts, 1.3.2): the store's journal-derived state written for the
  disk cache, and read back after resetAll() so a launch with nothing new in the logs skips the replay.
*/
import { hydrateFsdFuelOthers } from "../shared/fsdFuel.js";
import { hydrateFsdDrive } from "../shared/fsdDrives.js";
import { hydrateFsdWear } from "../shared/fsdWear.js";
import { hydrateOwnAssets } from "../shared/ownAssets.js";
import { hydrateJumponium } from "../shared/jumponium.js";
import { hydrateShipDamage } from "../shared/shipDamage.js";
import { hydrateJumpRangeOthers } from "../shared/jumpRange.js";
import { JOURNAL_MERGE_CACHE_FORMAT, type JournalMergeCachePayload } from "./journalMergePayload.js";
import { internParents, shareScanLists } from "./intern.js";
import type { GameStateStore } from "./gameState.js";

/** Journal replay snapshot for disk cache (`format` must match {@link JOURNAL_MERGE_CACHE_FORMAT}). */
export function serializeJournalMergePayload(store: GameStateStore): JournalMergeCachePayload {
  return {
    format: JOURNAL_MERGE_CACHE_FORMAT,
    commanderName: store.commanderName,
    commanderFid: store.commanderFid,
    currentSystem: store.currentSystem,
    currentSystemAddress: store.currentSystemAddress,
    viewingSystemAddress: store.viewingSystemAddress,
    visitedSystems: [...store.visitedSystems.entries()],
    systemVisitedAt: [...store.systemVisitedAt.entries()],
    systemStarClass: [...store.systemStarClass.entries()],
    targetedSystems: [...store.targetedSystems.entries()].map(([a, t]) => [a, t.name, t.starClass]),
    bodies: [...store.bodies.entries()],
    explorationScans: [...store.explorationScans.entries()],
    soldExplorationScans: [...store.soldExplorationScans.entries()],
    soldBodyKeys: [...store.soldBodyKeys],
    fssBodySignalsBodyKeys: [...store.fssBodySignalsBodyKeys],
    dssMappedBodyKeys: [...store.dssMappedBodyKeys],
    archivedDssMappedBodyKeys: [...store.archivedDssMappedBodyKeys],
    dssFirstMapperEligibleByBodyKey: [...store.dssFirstMapperEligibleByBodyKey.entries()],
    dssMappingEfficientByBodyKey: [...store.dssMappingEfficientByBodyKey.entries()],
    orbitParentPlanetByBody: [...store.orbitParentPlanetByBody.entries()],
    lastEventIso: store.lastEventIso,
    footJournalContextBuffer: store.footJournalContextBuffer.slice(),
    organicAnalyseByKey: [...store.organicAnalyseByKey.entries()],
    bodyDetailedFootfallState: [...store.bodyDetailedFootfallState.entries()],
    commanderPos: store.commanderPos,
    bodyFootfallFlag: [...store.bodyFootfallFlag.entries()],
    bodyMappedFlag: [...store.bodyMappedFlag.entries()],
    firstFootfallBodies: [...store.firstFootfallBodies],
    codexLoggedSpecies: [...store.codexLoggedSpecies],
    codexRegionLogged: [...store.codexRegionLogged],
    codexRegionBySystem: [...store.codexRegionBySystem.entries()],
    organicRunStartedAt: [...store.organicRunStartedAt.entries()],
    fsdTarget: store.fsdTarget,
    lastJumpTarget: store.lastJumpTarget,
    codexMapLogged: [...store.codexMapLogged],
    codexSightings: [...store.codexSightings],
    achievementDone: [...store.achievementDone],
    greenCodexBodies: [...store.greenCodexBodies],
    k10Systems: [...store.k10Systems],
    nspSeen: [...store.nspSeen],
    landingMinutesSamples: [...store.landingMinutesSamples],
    samplingMinutesSamples: [...store.samplingMinutesSamples],
    pendingOrganicSales: store.pendingOrganicSales.map((p) => ({ ...p })),
    surfaceShipMark: store.surfaceShipMark ? { ...store.surfaceShipMark } : null,
    overlayTouchdownBodyKey: store.overlayTouchdownBodyKey,
    currentBodyKey: store.currentBodyKey,
    fssAllBodiesCompleteSystems: [...store.fssAllBodiesCompleteSystems],
    systemLife: [...store.systemLife.entries()],
    fssDiscoveryScanBySystem: [...store.fssDiscoveryScanBySystem.entries()],
    fssAllBodiesFoundCountBySystem: [...store.fssAllBodiesFoundCountBySystem.entries()],
    soldExplorationBySystem: [...store.soldExplorationBySystem.entries()],
    soldOrganicBySystem: [...store.soldOrganicBySystem.entries()],
    mainStarWasDiscoveredBySystem: [...store.mainStarWasDiscoveredBySystem.entries()],
    mainStarSourceRankBySystem: [...store.mainStarSourceRankBySystem.entries()],
    systemPositions: [...store.systemPositions.entries()],
    remainingJumpsInRoute: store.remainingJumpsInRoute,
    loadoutMaxJumpRangeLy: store.loadoutMaxJumpRangeLy,
    loadoutFuelMainCapacityT: store.loadoutFuelMainCapacityT,
    loadoutFuelReserveCapacityT: store.loadoutFuelReserveCapacityT,
    lastFsdJumpFuelUsedT: store.lastFsdJumpFuelUsedT,
    lastFsdJumpDistLy: store.lastFsdJumpDistLy,
    jumpRange: structuredClone(store.jumpRange),
    fsdFuel: structuredClone(store.fsdFuel),
    fsdWear: structuredClone(store.fsdWear),
    shipDamage: structuredClone(store.shipDamage),
    ownAssets: structuredClone(store.ownAssets),
    jumponium: structuredClone(store.jumponium),
  };
}

/**
 * Restores journal-derived state after {@link resetAll}. User prefs on the store are unchanged
 * (they were not cleared by `resetAll`).
 */
export function hydrateJournalMergePayload(store: GameStateStore, data: JournalMergeCachePayload): boolean {
  /**
   * **Returns whether it restored anything**, and the return value is not decoration.
   *
   * This used to return `void` and bail silently on a payload it did not recognise, leaving the
   * store exactly as empty as it started. The caller could not tell that apart from a cache that
   * legitimately held nothing, so it went on to apply the new journal lines and *save* — writing an
   * empty history, with a complete file manifest, over a good cache. That is how the owner's
   * 7.8 MB cache became 538 bytes at 11:18 on 2026-09-07, taking the whole system view and the
   * accuracy probe's ground truth with it.
   *
   * A false here means "treat this as a cache miss and replay the logs".
   */
  // Exactly the current format, nothing else. This was an explicit allowlist (`!== 1 && !== 2`),
  // a third place the version had to be remembered: bumping the constant without editing it here
  // turns every cache into a permanent miss and replays 245 logs on every launch.
  if (data.format !== JOURNAL_MERGE_CACHE_FORMAT) return false;
  if (
    !Array.isArray(data.bodies) ||
    !Array.isArray(data.explorationScans) ||
    !Array.isArray(data.visitedSystems)
  ) {
    return false;
  }
  store.resetAll();
  store.commanderName = data.commanderName;
  store.commanderFid = data.commanderFid ?? null;
  store.currentSystem = data.currentSystem;
  store.currentSystemAddress = data.currentSystemAddress;
  store.viewingSystemAddress = data.viewingSystemAddress;
  store.lastEventIso = data.lastEventIso;
  for (const [addr, name] of data.visitedSystems) store.visitedSystems.set(addr, name);
  store.systemVisitedAt.clear();
  for (const [a, t] of data.systemVisitedAt ?? []) if (typeof a === "number" && typeof t === "string") store.systemVisitedAt.set(a, t);
  store.systemStarClass.clear();
  for (const [a, c] of data.systemStarClass ?? []) if (typeof a === "number" && typeof c === "string") store.systemStarClass.set(a, c);
  store.targetedSystems.clear();
  for (const [a, n, c] of data.targetedSystems ?? [])
    if (typeof a === "number" && typeof n === "string") store.targetedSystems.set(a, { name: n, starClass: typeof c === "string" ? c : "" });
  store.visitedSystemNames = null;
  for (const [k, v] of data.bodies) store.bodies.set(k, v);
  store.bodyKeysBySystem = null;
  store.confirmedVariantsRevision += 1;
  for (const [k, v] of data.explorationScans) store.explorationScans.set(k, v);
  for (const [k, v] of data.soldExplorationScans ?? []) store.soldExplorationScans.set(k, v);
  for (const k of data.soldBodyKeys ?? []) store.soldBodyKeys.add(k);
  // One copy of each list again: the cache wrote the body scans' and the records' lists apart (intern.ts).
  for (const m of [store.explorationScans, store.soldExplorationScans]) for (const r of m.values()) internParents(r.parents);
  shareScanLists(store.bodies, (k) => store.explorationScans.get(k) ?? store.soldExplorationScans.get(k));
  store.explorationScansRevision += 1;
  for (const k of data.fssBodySignalsBodyKeys) store.fssBodySignalsBodyKeys.add(k);
  for (const k of data.dssMappedBodyKeys) store.dssMappedBodyKeys.add(k);
  for (const k of data.archivedDssMappedBodyKeys ?? []) store.archivedDssMappedBodyKeys.add(k);
  for (const [k, v] of data.dssFirstMapperEligibleByBodyKey) store.dssFirstMapperEligibleByBodyKey.set(k, v);
  for (const [k, v] of data.dssMappingEfficientByBodyKey) store.dssMappingEfficientByBodyKey.set(k, v);
  for (const [k, v] of data.orbitParentPlanetByBody) store.orbitParentPlanetByBody.set(k, v);
  store.orbitParentRevision += 1;
  store.footJournalContextBuffer.length = 0;
  store.footJournalContextBuffer.push(...data.footJournalContextBuffer);
  for (const [k, v] of data.organicAnalyseByKey) store.organicAnalyseByKey.set(k, v);
  for (const [k, v] of data.bodyDetailedFootfallState) store.bodyDetailedFootfallState.set(k, v);
  store.commanderPos = data.commanderPos ?? null;
  for (const [k, v] of data.bodyFootfallFlag ?? []) store.bodyFootfallFlag.set(k, v);
  for (const [k, v] of data.bodyMappedFlag ?? []) store.bodyMappedFlag.set(k, v);
  for (const k of data.firstFootfallBodies) store.firstFootfallBodies.add(k);
  for (const k of data.codexLoggedSpecies ?? []) store.codexLoggedSpecies.add(k);
  for (const k of data.codexRegionLogged ?? []) store.codexRegionLogged.add(k);
  for (const [k, r] of data.codexRegionBySystem ?? []) store.codexRegionBySystem.set(k, r);
  for (const [k, t] of data.organicRunStartedAt ?? []) store.organicRunStartedAt.set(k, t);
  store.fsdTarget = data.fsdTarget ?? null;
  store.lastJumpTarget = data.lastJumpTarget ?? null;
  for (const k of data.codexMapLogged ?? []) store.codexMapLogged.add(k);
  for (const [k, t] of data.codexSightings ?? []) store.codexSightings.set(k, t);
  for (const [k, t] of data.achievementDone ?? []) store.achievementDone.set(k, t);
  for (const [k, id] of data.greenCodexBodies ?? []) store.greenCodexBodies.set(k, id);
  for (const a of data.k10Systems ?? []) store.k10Systems.add(a);
  for (const [a, names] of data.nspSeen ?? []) store.nspSeen.set(a, [...names]);
  store.landingMinutesSamples.push(...(data.landingMinutesSamples ?? []));
  store.samplingMinutesSamples.push(...(data.samplingMinutesSamples ?? []));
  store.pendingOrganicSales = data.pendingOrganicSales.map((p) => ({ ...p }));
  /*
    Format 6+. Two sources can know where the ship is parked and they arrive in a fixed order:
    the marks file is read when the store is built, this cache lands on top of it.

    So "last one wins" would mean the cache always wins, including when it is the older answer —
    a full cache hit skips the journal entirely, so a Touchdown made after the cache was written
    is not replayed and could be silently overwritten by a stale one. Whichever was recorded later
    wins instead, and an absent cache value never clears a mark the file supplied.
  */
  const cachedShip = data.surfaceShipMark ? { ...data.surfaceShipMark } : null;
  if (cachedShip) {
    const have = store.surfaceShipMark;
    if (!have || !have.atIso || (cachedShip.atIso ?? "") >= have.atIso) store.surfaceShipMark = cachedShip;
  }
  store.overlayTouchdownBodyKey = data.overlayTouchdownBodyKey ?? null;
  store.currentBodyKey = data.currentBodyKey ?? null;
  for (const addr of data.fssAllBodiesCompleteSystems) store.fssAllBodiesCompleteSystems.add(addr);
  for (const [addr, life] of data.systemLife ?? []) store.systemLife.set(addr, life);
  for (const [addr, row] of data.fssDiscoveryScanBySystem) {
    store.fssDiscoveryScanBySystem.set(addr, { ...row });
  }
  store.fssAllBodiesFoundCountBySystem.clear();
  for (const [addr, cnt] of data.fssAllBodiesFoundCountBySystem ?? []) {
    if (typeof addr === "number" && typeof cnt === "number" && cnt > 0) {
      store.fssAllBodiesFoundCountBySystem.set(addr, cnt);
    }
  }
  for (const [target, rows] of [
    [store.soldExplorationBySystem, data.soldExplorationBySystem],
    [store.soldOrganicBySystem, data.soldOrganicBySystem],
  ] as const) {
    target.clear();
    for (const [addr, t] of rows ?? []) {
      if (typeof addr !== "number" || !t || typeof t.credits !== "number") continue;
      target.set(addr, {
        credits: t.credits,
        items: typeof t.items === "number" ? t.items : 0,
        sales: typeof t.sales === "number" ? t.sales : 0,
        lastAt: typeof t.lastAt === "string" ? t.lastAt : "",
      });
    }
  }
  // No version branch here on purpose: the loader admits a payload only when its `format` equals
  // JOURNAL_MERGE_CACHE_FORMAT exactly, so anything reaching this point is current. A `>= n` test
  // reads as though older caches still flow through and quietly excuses a missing field — which is
  // how `mainStarWasDiscoveredBySystem` shipped restoring nothing. Trust the per-value type checks.
  store.systemPositions.clear();
  for (const [a, p] of data.systemPositions ?? []) {
    if (typeof a === "number" && p && typeof p.x === "number") store.systemPositions.set(a, p);
  }
  store.mainStarWasDiscoveredBySystem.clear();
  for (const [a, w] of data.mainStarWasDiscoveredBySystem ?? []) {
    if (typeof a === "number" && typeof w === "boolean") store.mainStarWasDiscoveredBySystem.set(a, w);
  }
  store.mainStarSourceRankBySystem.clear();
  for (const [a, r] of data.mainStarSourceRankBySystem ?? []) {
    if (typeof a === "number" && typeof r === "number") store.mainStarSourceRankBySystem.set(a, r);
  }
  // A cache from before the ranks were saved: every stored answer counts as already taken.
  for (const a of store.mainStarWasDiscoveredBySystem.keys()) {
    if (!store.mainStarSourceRankBySystem.has(a)) store.mainStarSourceRankBySystem.set(a, 0);
  }
  const rj = data.remainingJumpsInRoute;
  store.remainingJumpsInRoute =
    typeof rj === "number" && Number.isFinite(rj) ? Math.max(0, Math.floor(rj)) : null;
  const lmj = data.loadoutMaxJumpRangeLy;
  store.loadoutMaxJumpRangeLy = typeof lmj === "number" && Number.isFinite(lmj) && lmj > 0 ? lmj : null;
  const lfm = data.loadoutFuelMainCapacityT;
  store.loadoutFuelMainCapacityT = typeof lfm === "number" && Number.isFinite(lfm) && lfm > 0 ? lfm : null;
  const lfr = data.loadoutFuelReserveCapacityT;
  store.loadoutFuelReserveCapacityT =
    typeof lfr === "number" && Number.isFinite(lfr) && lfr >= 0 ? lfr : null;
  const lff = data.lastFsdJumpFuelUsedT;
  store.lastFsdJumpFuelUsedT = typeof lff === "number" && Number.isFinite(lff) && lff > 0 ? lff : null;
  const jr = data.jumpRange;
  if (jr && Array.isArray(jr.long) && Array.isArray(jr.recent)) {
    store.jumpRange = {
      shipId: typeof jr.shipId === "number" ? jr.shipId : null,
      loadoutLy: typeof jr.loadoutLy === "number" ? jr.loadoutLy : null,
      long: jr.long.filter((d) => typeof d === "number" && d > 0),
      recent: jr.recent.filter((d) => typeof d === "number" && d > 0),
      others: hydrateJumpRangeOthers(jr.others),
    };
  }
  const ff = data.fsdFuel;
  if (ff && Array.isArray(ff.samples)) {
    store.fsdFuel = {
      shipId: typeof ff.shipId === "number" ? ff.shipId : null,
      loadoutLy: typeof ff.loadoutLy === "number" ? ff.loadoutLy : null,
      unladenT: typeof ff.unladenT === "number" ? ff.unladenT : null,
      maxFuelPerJumpT: typeof ff.maxFuelPerJumpT === "number" ? ff.maxFuelPerJumpT : null,
      boosterLy: typeof ff.boosterLy === "number" && ff.boosterLy > 0 ? ff.boosterLy : 0,
      drive: hydrateFsdDrive(ff.drive),
      cargoT: typeof ff.cargoT === "number" ? ff.cargoT : null,
      samples: ff.samples.filter((s) => s && s.ly > 0 && s.fuelT > 0 && s.massT > 0),
      fsd: typeof ff.fsd === "string" ? ff.fsd : null,
      others: hydrateFsdFuelOthers(ff.others),
    };
  }
  store.fsdWear = hydrateFsdWear(data.fsdWear);
  store.shipDamage = hydrateShipDamage(data.shipDamage);
  store.ownAssets = hydrateOwnAssets(data.ownAssets);
  store.jumponium = hydrateJumponium(data.jumponium);
  const ljd = data.lastFsdJumpDistLy;
  store.lastFsdJumpDistLy = typeof ljd === "number" && Number.isFinite(ljd) && ljd > 0 ? ljd : null;
  return true;
}
