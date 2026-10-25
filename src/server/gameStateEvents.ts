/*
  The journal event handlers of GameStateStore (split out of gameState.ts, discuss item 30, 1.3.1): one function per
  event over the store, called from GameStateStore.apply. Commander and load, jumps and targets, codex and geology,
  FSS and DSS signals, touchdown and liftoff, Scan and ScanOrganic, embark and disembark, death.
*/
import type { JournalLine, PlanetScan, OrganicGenusLock } from "../shared/types.js";
import {
  displayLabelFromOrganicLine,
  nextOrganicProgressCount,
  speciesKeyFromOrganicJournal,
} from "./organicTracking.js";
import { isK10CodexName } from "../shared/greenGasGiant.js";
import { isNspCodexName } from "../shared/nspOutlook.js";
import { getProjectRoot } from "./paths.js";
import {
  journalLineCarriesPlanetMetrics,
  planetScanFromExplorationRecord,
  recordFootScanned,
} from "./footScannedCatalog.js";
import {
  wipeOrganicSampleSession,
  clearPersistedOrganicSampleSession,
  normStatusBodyName,
} from "./organicSampleSessionFile.js";
import { regionJoinKey } from "../shared/regionMap.js";
import {
  codexEntryKey,
  codexOrganicLockFromLine,
  codexRegionKeysFromLine,
  codexMapKeyFromLine,
  codexSpeciesFromLine,
} from "../shared/codexLog.js";
import { GEOLOGY_KEY, isLegacyPlantKey } from "../shared/achievements.js";
import { fsdFuelLoadout } from "../shared/fsdFuel.js";
import { fsdWearLoadout } from "../shared/fsdWear.js";
import { shipDamageLoadout } from "../shared/shipDamage.js";
import { jumpRangeLoadout } from "../shared/jumpRange.js";
import { bodyKey } from "../shared/bodyKey.js";
import {
  asGenuses,
  asSignals,
  biologicalCount,
  ensureBody,
  geologicalCount,
  journalLineBodyDisplayName,
  journalLineMatchesBodyIds,
  mergeGenusHints,
  mergeScannerSignalHints,
  upsertFootOrganicLock,
} from "./gameStateHelpers.js";
import type { GameStateStore } from "./gameState.js";
import * as explorationSales from "./gameStateSales.js";
import * as explorationMerge from "./gameStateExploration.js";

const FOOT_JOURNAL_BUFFER_MAX = 600;

/** Append after each `apply` (in `finally`) so the buffer contains only lines **before** the next event. */
export function appendFootJournalContext(store: GameStateStore, line: JournalLine): void {
  store.footJournalContextBuffer.push(line);
  const over = store.footJournalContextBuffer.length - FOOT_JOURNAL_BUFFER_MAX;
  if (over > 0) store.footJournalContextBuffer.splice(0, over);
}

/** Nearest prior journal line (same system + body id) that carries a `Body` or `BodyName` string. */
export function findRecentJournalBodyName(store: GameStateStore, systemAddress: number, bodyId: number): string | null {
  for (let i = store.footJournalContextBuffer.length - 1; i >= 0; i--) {
    const jl = store.footJournalContextBuffer[i]!;
    if (!journalLineMatchesBodyIds(jl, systemAddress, bodyId)) continue;
    const nm = journalLineBodyDisplayName(jl);
    if (nm) return nm;
  }
  return null;
}

/** Nearest prior line in the same system with a non-empty `StarSystem` string. */
export function findRecentJournalStarSystem(store: GameStateStore, systemAddress: number): string | null {
  for (let i = store.footJournalContextBuffer.length - 1; i >= 0; i--) {
    const jl = store.footJournalContextBuffer[i]!;
    if (typeof jl.SystemAddress !== "number" || jl.SystemAddress !== systemAddress) continue;
    const ss = jl.StarSystem;
    if (typeof ss === "string" && ss.trim()) return ss.trim();
  }
  return null;
}

/** `Commander` — one of apply()'s event handlers. */
export function onCommander(store: GameStateStore, line: JournalLine): void {
  const fid = (line as Record<string, unknown>).FID;
  if (typeof fid === "string" && fid.trim()) store.commanderFid = fid.trim();
  const nm = (line as Record<string, unknown>).Name;
  if (typeof nm === "string" && nm.trim()) store.commanderName = nm.trim();
  return;
}

/** `LoadGame` — one of apply()'s event handlers. */
export function onLoadGame(store: GameStateStore, line: JournalLine): void {
  const cmd = line.Commander as string | undefined;
  if (typeof cmd === "string" && cmd.trim()) store.commanderName = cmd.trim();
  const fid = (line as Record<string, unknown>).FID;
  if (typeof fid === "string" && fid.trim()) store.commanderFid = fid.trim();
  const fc = (line as Record<string, unknown>).FuelCapacity;
  if (typeof fc === "number" && Number.isFinite(fc) && fc > 0) {
    store.loadoutFuelMainCapacityT = fc;
  }
  return;
}

/** `Loadout` — one of apply()'s event handlers. */
export function onLoadout(store: GameStateStore, line: JournalLine): void {
  const mjr = (line as Record<string, unknown>).MaxJumpRange;
  const shipId = (line as Record<string, unknown>).ShipID;
  fsdFuelLoadout(store.fsdFuel, line as Record<string, unknown>);
  fsdWearLoadout(store.fsdWear, line as Record<string, unknown>);
  shipDamageLoadout(store.shipDamage, line as Record<string, unknown>);
  jumpRangeLoadout(
    store.jumpRange,
    typeof shipId === "number" ? shipId : null,
    typeof mjr === "number" && Number.isFinite(mjr) && mjr > 0 ? mjr : null,
  );
  if (typeof mjr === "number" && Number.isFinite(mjr) && mjr > 0) {
    store.loadoutMaxJumpRangeLy = mjr;
  }
  const fc = (line as Record<string, unknown>).FuelCapacity;
  if (fc && typeof fc === "object") {
    const o = fc as Record<string, unknown>;
    const main = o.Main;
    const res = o.Reserve;
    if (typeof main === "number" && Number.isFinite(main) && main > 0) {
      store.loadoutFuelMainCapacityT = main;
    }
    if (typeof res === "number" && Number.isFinite(res) && res >= 0) {
      store.loadoutFuelReserveCapacityT = res;
    }
  }
  return;
}

/**
 * Leaving the body. The game drops a half-collected sample the moment the ship leaves the planet, and
 * the HUD should fold with it rather than keep showing a radar for ground that is no longer underfoot
 * — the owner saw the tracker stay open through a jump. `Status.json` cannot tell us this on its own:
 * it keeps reporting a latitude from orbit.
 */
export function leaveBody(store: GameStateStore): void {
  store.overlayTouchdownBodyKey = null;
  if (store.exoOrganicTracker) {
    store.exoOrganicTracker = null;
    clearPersistedOrganicSampleSession(getProjectRoot());
  }
}

/** `FSDJump` / `CarrierJump` — one of apply()'s event handlers. */
export function onFSDJumpEtc(store: GameStateStore, line: JournalLine, ts: string, event: string): void {
  const sys = line.StarSystem as string;
  const addr = line.SystemAddress as number;
  // Both leave the body: a carrier jump never reached the wipe in apply(), which ran after this
  // handler had returned (plan 2.4, Fable S3).
  leaveBody(store);
  if (event === "FSDJump" && typeof addr === "number") {
    // The next-jump card: the target is reached (held for a minute), the nav lock is spent.
    if (
      store.lastJumpTarget &&
      (store.lastJumpTarget.systemAddress === addr || !store.lastJumpTarget.systemAddress)
    ) {
      store.lastJumpTarget = { ...store.lastJumpTarget, arrived: true };
    }
    if (store.fsdTarget && store.fsdTarget.systemAddress === addr) store.fsdTarget = null;
  }
  if (sys && typeof addr === "number") {
    // No `WasDiscovered` read here: jump events do not carry it. See
    // `mainStarWasDiscoveredBySystem`, which is filled from `Scan` instead.
    store.viewingSystemAddress = null;
    store.setPositionFromLine(line);
    store.notePopulation(line, ts);
    store.resetSystem(sys, addr);
  }
  return;
}

/** `FSDTarget` — one of apply()'s event handlers. */
export function onFSDTarget(store: GameStateStore, line: JournalLine, ts: string): void {
  const rj = (line as Record<string, unknown>).RemainingJumpsInRoute;
  if (typeof rj === "number" && Number.isFinite(rj)) {
    store.remainingJumpsInRoute = Math.max(0, Math.floor(rj));
  }
  const name = typeof line.Name === "string" ? line.Name : "";
  const addr = typeof line.SystemAddress === "number" ? line.SystemAddress : 0;
  const starClass = typeof line.StarClass === "string" ? line.StarClass : "";
  if (name) store.fsdTarget = { starSystem: name, systemAddress: addr, starClass, at: ts };
  if (name && addr) {
    store.targetedSystems.set(addr, { name, starClass });
    store.boxelsRevision++;
  }
  return;
}

/** `Location` — one of apply()'s event handlers. */
export function onLocation(store: GameStateStore, line: JournalLine, ts: string): void {
  const sys = line.StarSystem as string;
  const addr = line.SystemAddress as number;
  if (sys && typeof addr === "number") {
    store.setPositionFromLine(line);
    store.notePopulation(line, ts);
    /*
      In another system it is an arrival, as a jump is (plan 2.4, Fable S9): a respawn, a rescue or a
      relog after a carrier move lands here with no FSDJump. Let go of the system the app was pointed
      at and close the one left, or the tabs stay on the old place. A relog where the commander
      already was changes nothing.
    */
    if (store.currentSystemAddress !== null && store.currentSystemAddress !== addr) {
      store.viewingSystemAddress = null;
      store.resetSystem(sys, addr);
    } else {
      store.setLocation(sys, addr);
    }
  }
  return;
}

/** `SupercruiseExit` — one of apply()'s event handlers. */
export function onSupercruiseExit(store: GameStateStore, line: JournalLine, ts: string): void {
  const body = typeof line.Body === "string" ? line.Body.trim() : "";
  const at = Date.parse(ts);
  if (body && Number.isFinite(at)) store.scExitAt = { at, body };
  return;
}

/** `CodexEntry` — one of apply()'s event handlers. */
export function onCodexEntry(store: GameStateStore, line: JournalLine, ts: string): void {
  const species = codexSpeciesFromLine(line as Parameters<typeof codexSpeciesFromLine>[0]);
  if (species) store.codexLoggedSpecies.add(species);
  for (const k of codexRegionKeysFromLine(line as Parameters<typeof codexRegionKeysFromLine>[0])) {
    store.codexRegionLogged.add(k);
  }
  const mapKey = codexMapKeyFromLine(line as Parameters<typeof codexMapKeyFromLine>[0]);
  if (mapKey) store.codexMapLogged.add(mapKey);
  // Green gas giants: the codex names the body; a K10 anomaly names the system (shared/greenGasGiant.ts).
  if (typeof line.SystemAddress === "number" && Number.isFinite(line.SystemAddress)) {
    const name = typeof line.Name === "string" ? line.Name : "";
    applyGreenCodex(store, line);
    if (isK10CodexName(name)) store.k10Systems.add(line.SystemAddress);
    // A phenomenon named by the codex (same families as the EDAstro NSP list).
    if (isNspCodexName(name)) {
      const label = (typeof line.Name_Localised === "string" && line.Name_Localised.trim()) || "Notable stellar phenomenon";
      noteNsp(store, line.SystemAddress, label);
    }
  }
  {
    const rk = typeof line.Region_Localised === "string" ? regionJoinKey(line.Region_Localised) : "";
    if (rk && typeof line.SystemAddress === "number") store.codexRegionBySystem.set(line.SystemAddress, rk);
    // A legacy plant is never sampled three times: its codex line is what counts.
    const entry = codexEntryKey(typeof line.Name === "string" ? line.Name : "");
    if (rk && entry && isLegacyPlantKey(entry)) store.noteAchievementDone(`${rk}|${entry}`, ts);
  }
  const sightingRegion = typeof line.Region_Localised === "string" ? regionJoinKey(line.Region_Localised) : "";
  if (species && sightingRegion && typeof line.SystemAddress === "number") {
    const k = `${species}|${sightingRegion}|${line.SystemAddress}`;
    const prev = store.codexSightings.get(k);
    if (!prev || ts < prev) store.codexSightings.set(k, ts);
  }

  /*
    The composition scanner confirms a species on a body without a landing, and the owner asked
    for it: some plants grow where a ship will not go down. The line names both halves —
    `Name_Localised` is "Fonticulua Fluctus - Amethyst" and `BodyID`/`SystemAddress` say where —
    so it resolves to the same lock a `ScanOrganic` would build, carrying `source: "codex"` so
    the panel can say which it was.

    `SubCategory` has to be read, not just `Category`: the category is "Biological and
    Geological" and a fumarole would otherwise confirm a plant.
  */
  noteGeologyCodex(store, line, ts);
  const lock = codexOrganicLockFromLine(line as Parameters<typeof codexOrganicLockFromLine>[0]);
  const codexBodyId = line.BodyID as number | undefined;
  if (!lock || typeof codexBodyId !== "number" || !Number.isFinite(codexBodyId)) return;
  const codexSystem = line.SystemAddress as number | undefined;
  if (typeof codexSystem !== "number" || !Number.isFinite(codexSystem)) return;

  const codexStarSystem =
    (typeof line.System === "string" ? line.System.trim() : "") ||
    store.visitedSystems.get(codexSystem) ||
    store.currentSystem ||
    "";
  const codexBody = ensureBody(
    store.bodies,
    codexSystem,
    codexBodyId,
    store.explorationScans.get(bodyKey(codexSystem, codexBodyId))?.bodyName ??
      findRecentJournalBodyName(store, codexSystem, codexBodyId) ??
      `Body ${codexBodyId}`,
    codexStarSystem,
    ts,
  );
  // A comp scan fires more than once for the same plant, and a foot scan of the same species
  // says strictly more. Either way one row per species on this body is enough.
  // A lock copied from a sibling moon is only a hint, and gives way to this body's own scan.
  const sameSpecies = (l: OrganicGenusLock) =>
    l.speciesLocalised.trim().toLowerCase() === lock.speciesLocalised.trim().toLowerCase();
  const codexLock: OrganicGenusLock = { ...lock, at: ts };
  const siblingIdx = codexBody.organicGenusLocks.findIndex((l) => sameSpecies(l) && l.fromSibling);
  const existing = codexBody.organicGenusLocks.find((l) => sameSpecies(l) && !l.fromSibling);
  if (siblingIdx >= 0) codexBody.organicGenusLocks[siblingIdx] = codexLock;
  else if (!existing) codexBody.organicGenusLocks.push(codexLock);
  // Scanned again with the ship: still a comp scan, but the most recent thing scanned.
  else if (existing.source === "codex") existing.at = ts;
  if (lock.variantLocalised && !codexBody.confirmedVariants.includes(lock.variantLocalised)) {
    codexBody.confirmedVariants.push(lock.variantLocalised);
    store.confirmedVariantsRevision += 1;
  }
  return;
}

/**
 * A surface geology codex line (fumarole, gas vent, geyser, lava spout) with the body it names: the
 * Volcanism field marks that entry "Scanned" on this body (owner, 2026-10-05).
 */
export function noteGeologyCodex(store: GameStateStore, line: JournalLine, ts: string): void {
  const entry = codexEntryKey(typeof line.Name === "string" ? line.Name : "");
  const bodyId = line.BodyID;
  const sys = line.SystemAddress;
  if (!entry || !GEOLOGY_KEY.test(entry) || typeof bodyId !== "number" || typeof sys !== "number") return;
  const b = ensureBody(
    store.bodies,
    sys,
    bodyId,
    store.explorationScans.get(bodyKey(sys, bodyId))?.bodyName ??
      findRecentJournalBodyName(store, sys, bodyId) ??
      `Body ${bodyId}`,
    (typeof line.System === "string" ? line.System.trim() : "") || store.visitedSystems.get(sys) || store.currentSystem || "",
    ts,
  );
  if (!(b.geologyLogged ?? []).includes(entry)) b.geologyLogged = [...(b.geologyLogged ?? []), entry];
}

/** A phenomenon in a system: a name, or "" for the FSS signal before it is named. */
export function noteNsp(store: GameStateStore, systemAddress: number, name: string): void {
  const list = store.nspSeen.get(systemAddress) ?? [];
  if (name && !list.includes(name)) list.push(name);
  if (!name && !list.length) list.push("");
  // A named one replaces the placeholder.
  store.nspSeen.set(systemAddress, list.length > 1 ? list.filter(Boolean) : list);
}

/** `FSSSignalDiscovered` of a notable stellar phenomenon (`$Fixed_Event_Life_…`). */
export function onFssSignalNsp(store: GameStateStore, line: JournalLine): void {
  const addr = line.SystemAddress;
  const name = typeof line.SignalName === "string" ? line.SignalName : "";
  if (typeof addr !== "number" || !Number.isFinite(addr) || !/^\$fixed_event_life_/i.test(name)) return;
  noteNsp(store, addr, "");
}

/** `FSSDiscoveryScan` — one of apply()'s event handlers. */
export function onFSSDiscoveryScan(store: GameStateStore, line: JournalLine): void {
  const addr = line.SystemAddress as number;
  const sysRaw = line.SystemName as string | undefined;
  const bodyCountRaw = line.BodyCount as number | undefined;
  const progressRaw = line.Progress as number | undefined;
  if (typeof addr !== "number" || typeof bodyCountRaw !== "number" || !Number.isFinite(bodyCountRaw))
    return;
  const bodyCount = Math.max(0, Math.floor(bodyCountRaw));
  if (bodyCount <= 0) return;
  let progress = typeof progressRaw === "number" && Number.isFinite(progressRaw) ? progressRaw : 0;
  progress = Math.max(0, Math.min(1, progress));
  const sysTrim = typeof sysRaw === "string" && sysRaw.trim() ? sysRaw.trim() : "";
  store.fssDiscoveryScanBySystem.set(addr, {
    systemName: sysTrim,
    bodyCount,
    progress,
  });
  if (sysTrim) store.rememberVisitedSystem(sysTrim, addr);
  return;
}

/** `FSSAllBodiesFound` — one of apply()'s event handlers. */
export function onFSSAllBodiesFound(store: GameStateStore, line: JournalLine): void {
  const addr = line.SystemAddress as number;
  const sysNm = line.SystemName as string | undefined;
  const sysStar = line.StarSystem as string | undefined;
  const sysRaw = (typeof sysNm === "string" && sysNm.trim() ? sysNm : sysStar) as string | undefined;
  const cntRaw = (line as Record<string, unknown>).Count;
  if (typeof addr === "number") {
    store.fssAllBodiesCompleteSystems.add(addr);
    if (typeof cntRaw === "number" && Number.isFinite(cntRaw)) {
      const n = Math.max(0, Math.floor(cntRaw));
      if (n > 0) store.fssAllBodiesFoundCountBySystem.set(addr, n);
    }
    if (sysRaw?.trim()) store.rememberVisitedSystem(sysRaw.trim(), addr);
  }
  return;
}

/** `FSSBodySignals` — one of apply()'s event handlers. */
export function onFSSBodySignals(store: GameStateStore, line: JournalLine, ts: string): void {
  const systemAddress = line.SystemAddress as number;
  const bodyId = line.BodyID as number;
  if (typeof systemAddress !== "number" || typeof bodyId !== "number") return;

  const bk = bodyKey(systemAddress, bodyId);
  store.fssBodySignalsBodyKeys.add(bk);

  const inCurrent = store.currentSystemAddress !== null && systemAddress === store.currentSystemAddress;
  if (!inCurrent) return;

  const bodyNameRaw = line.BodyName as string | undefined;
  const bodyName = bodyNameRaw?.trim() ? bodyNameRaw.trim() : `Body ${bodyId}`;
  const hints = asGenuses((line as Record<string, unknown>).Genuses);
  const sigArr = asSignals(line.Signals);
  const n = biologicalCount(sigArr);
  if (n === null && !hints && sigArr.length === 0) return;

  const b = ensureBody(store.bodies, systemAddress, bodyId, bodyName, store.currentSystem ?? "", ts);
  if (n !== null) b.biologicalSignals = n;
  const geo = geologicalCount(sigArr);
  if (geo !== null) b.geologicalSignals = geo;
  if (hints) b.genusHints = mergeGenusHints(b.genusHints, hints);
  const mergedHints = mergeScannerSignalHints(b.signalHints ?? null, line.Signals);
  if (mergedHints) b.signalHints = mergedHints;
  explorationMerge.propagateExoAmongSimilarMoons(store, bodyId, systemAddress, ts, "fss_signals");
  return;
}

/** `SAASignalsFound` — one of apply()'s event handlers. */
export function onSAASignalsFound(store: GameStateStore, line: JournalLine, ts: string): void {
  const systemAddress = line.SystemAddress as number;
  const bodyId = line.BodyID as number;
  const bodyName = line.BodyName as string;
  if (
    store.currentSystemAddress === null ||
    systemAddress !== store.currentSystemAddress ||
    typeof bodyId !== "number" ||
    !bodyName
  )
    return;

  const hints = asGenuses(line.Genuses);
  const sigArr = asSignals(line.Signals);
  const n = biologicalCount(sigArr);
  if (n === null && !hints && sigArr.length === 0) return;

  const b = ensureBody(store.bodies, systemAddress, bodyId, bodyName, store.currentSystem ?? "", ts);
  if (n !== null) b.biologicalSignals = n;
  const geo = geologicalCount(sigArr);
  if (geo !== null) b.geologicalSignals = geo;
  if (hints) b.genusHints = hints;
  const mergedHints = mergeScannerSignalHints(b.signalHints ?? null, line.Signals);
  if (mergedHints) b.signalHints = mergedHints;
  explorationMerge.propagateExoAmongSimilarMoons(store, bodyId, systemAddress, ts, "saas_signals");
  return;
}

/** `SAAScanComplete` — one of apply()'s event handlers. */
export function onSAAScanComplete(store: GameStateStore, line: JournalLine, ts: string): void {
  const systemAddress = line.SystemAddress as number;
  const bodyId = line.BodyID as number;
  if (typeof systemAddress !== "number" || typeof bodyId !== "number") return;

  const bk = bodyKey(systemAddress, bodyId);
  store.dssMappedBodyKeys.add(bk);
  // Our own DSS: the body is mapped from this moment on, whoever got there first.
  store.observeMapped(bk, true, "journal", (line.timestamp as string) ?? new Date().toISOString());
  const recForMapper = store.explorationScans.get(bk);
  store.dssFirstMapperEligibleByBodyKey.set(bk, recForMapper ? recForMapper.wasMapped !== true : false);
  const probes = line.ProbesUsed as number | undefined;
  const effTarget = line.EfficiencyTarget as number | undefined;
  const efficient =
    typeof probes === "number" &&
    typeof effTarget === "number" &&
    effTarget > 0 &&
    probes > 0 &&
    probes <= effTarget;
  store.dssMappingEfficientByBodyKey.set(bk, efficient);

  const inCurrent = store.currentSystemAddress !== null && systemAddress === store.currentSystemAddress;
  if (inCurrent) {
    const bodyNameRaw = line.BodyName as string | undefined;
    const bodyName = bodyNameRaw?.trim() ? bodyNameRaw.trim() : `Body ${bodyId}`;
    const b = ensureBody(store.bodies, systemAddress, bodyId, bodyName, store.currentSystem ?? "", ts);
    b.dssComplete = true;
    explorationMerge.propagateExoAmongSimilarMoons(store, bodyId, systemAddress, ts, "dss_complete");
  }
  store.requestUiAutoSelectBody(systemAddress, bodyId);
  return;
}

/** `Touchdown` — one of apply()'s event handlers. */
export function onTouchdown(store: GameStateStore, line: JournalLine, ts: string): void {
  // How long the last approach took, when this is the body we dropped at.
  const tdBody = typeof line.Body === "string" ? line.Body.trim() : "";
  const tdAt = Date.parse(ts);
  if (store.scExitAt && tdBody && tdBody === store.scExitAt.body && Number.isFinite(tdAt)) {
    const minutes = (tdAt - store.scExitAt.at) / 60_000;
    // Over half an hour is a commander who went to make tea, not an approach.
    if (minutes > 0 && minutes < 30) store.landingMinutesSamples.push(minutes);
  }
  store.scExitAt = null;

  const playerControlled = line.PlayerControlled === true;
  const taxi = line.Taxi === true;
  const onPlanet = line.OnPlanet === true;
  const onStation = line.OnStation === true;
  const systemAddress = line.SystemAddress as number | undefined;
  const bodyId = line.BodyID as number | undefined;
  const bodyStr = line.Body;
  const starSystem = line.StarSystem;
  if (
    playerControlled &&
    !taxi &&
    onPlanet &&
    !onStation &&
    typeof systemAddress === "number" &&
    typeof bodyId === "number"
  ) {
    const starFromLine = typeof starSystem === "string" && starSystem.trim() ? starSystem.trim() : null;
    const star =
      starFromLine ??
      store.visitedSystems.get(systemAddress)?.trim() ??
      store.currentSystem?.trim() ??
      "";
    const nameFromJournal = typeof bodyStr === "string" && bodyStr.trim() ? bodyStr.trim() : null;
    const nm = nameFromJournal ?? `Body ${bodyId}`;
    ensureBody(store.bodies, systemAddress, bodyId, nm, star, ts);
    store.overlayTouchdownBodyKey = bodyKey(systemAddress, bodyId);
    /*
      Where the ship is parked, for the minimap. Straight off the journal line — Touchdown
      carries Latitude and Longitude — so this one needs no live Status.json read.
    */
    const tdLat = line.Latitude;
    const tdLon = line.Longitude;
    if (typeof tdLat === "number" && typeof tdLon === "number") {
      store.surfaceShipMark = {
        bodyKey: bodyKey(systemAddress, bodyId),
        // Status.json names the body and never gives its id, so the name is what a live fix
        // can be matched against.
        bodyNameNorm: normStatusBodyName(nm) ?? "",
        latDeg: tdLat,
        lonDeg: tdLon,
        label: "Your ship",
        atIso: ts,
      };
      store.persistSurfaceMarks();
    }
    store.requestUiAutoSelectBody(systemAddress, bodyId);
  }
  return;
}

/** `Liftoff` — one of apply()'s event handlers. */
export function onLiftoff(store: GameStateStore): void {
  /*
    The ship has gone, so the mark goes with it — the owner's rule: "after takeoff, the
    'position landed' for the ship gets removed, we keep only the scans." A stale ship marker
    is worse than none: it is an instruction to walk to a place nothing is parked.
  */
  store.surfaceShipMark = null;
  store.persistSurfaceMarks();
  return;
}

/** `ScanBaryCentre` — one of apply()'s event handlers. */
export function onScanBaryCentre(store: GameStateStore, line: JournalLine, ts: string): void {
  explorationMerge.mergeBarycentreJournalLine(store, line, ts);
  const starSystemBary = line.StarSystem as string | undefined;
  const addrBary = line.SystemAddress as number | undefined;
  if (typeof starSystemBary === "string" && starSystemBary.trim() && typeof addrBary === "number") {
    store.rememberVisitedSystem(starSystemBary.trim(), addrBary);
  }
  return;
}

/** `Scan` — one of apply()'s event handlers. */
/** A green codex entry and the gas giant scanned with it, whichever line comes first. */
export function applyGreenCodex(store: GameStateStore, line: JournalLine): void {
  for (const e of store.greenCodexMatcher.observe(line as Record<string, unknown>)) {
    if (e.kind === "match") store.greenCodexBodies.set(e.bodyKey, e.codexId);
    else store.greenCodexBodies.delete(e.bodyKey);
  }
}

export function onScan(store: GameStateStore, line: JournalLine, ts: string): void {
  applyGreenCodex(store, line);
  const systemAddress = line.SystemAddress as number;
  const bodyId = line.BodyID as number;
  const bodyName = line.BodyName as string;
  if (
    typeof systemAddress === "number" &&
    typeof bodyId === "number" &&
    typeof bodyName === "string" &&
    bodyName.trim()
  ) {
    explorationMerge.mergeExplorationScan(store, line, ts);
    const starSystemMerge = line.StarSystem as string | undefined;
    if (typeof starSystemMerge === "string" && starSystemMerge.trim()) {
      store.rememberVisitedSystem(starSystemMerge.trim(), systemAddress);
    }
  }

  /*
   * `WasFootfalled` and `WasMapped` are read from **every** scan that carries them, not only
   * the detailed one — and that placement is the whole bug this block exists to prevent.
   *
   * Aucoks OG-E b18-3 A 1, 2026-09-09, is the case that found it. The game wrote two scans:
   *
   *   11:55:05  AutoScan   WasMapped true   WasFootfalled true
   *   11:56:10  Detailed   WasMapped false  WasFootfalled false
   *
   * The second arrives immediately after the commander's own `SAAScanComplete` and contradicts
   * the first. With these reads sitting below a `ScanType !== "Detailed"` return, the honest
   * `true` was thrown away unseen and only the `false` was ever recorded — so a body somebody
   * else had already walked was offered as an unclaimed 5x. Footfall does not un-happen; the
   * sticky-`true` merge in observedFlag.ts is what settles the contradiction, but it can only
   * do that if it is shown both claims.
   *
   * The physics below has its own admission test, on what the line contains rather than on its
   * label — an auto scan from flying to a body carries the whole record.
   */
  if (
    typeof systemAddress === "number" &&
    typeof bodyId === "number" &&
    typeof bodyName === "string" &&
    bodyName.trim()
  ) {
    const anyScanTs = (line.timestamp as string) ?? new Date().toISOString();
    const wf = line.WasFootfalled;
    if (typeof wf === "boolean") {
      store.observeFootfall(bodyKey(systemAddress, bodyId), wf, "journal", anyScanTs);
    }
    // `Scan.WasMapped` is "had anyone mapped this at the moment of the scan". Our own DSS makes
    // later scans report true, which is why the *first-mapper* question is frozen separately at
    // SAAScanComplete — but for "has anyone mapped it", a later true is simply correct.
    const wm = (line as Record<string, unknown>).WasMapped;
    if (typeof wm === "boolean") {
      store.observeMapped(bodyKey(systemAddress, bodyId), wm, "journal", anyScanTs);
    }
  }

  /*
   * Accept any scan that actually describes the body, whatever it is labelled.
   *
   * This used to require `ScanType === "Detailed"`, on the assumption that nothing else
   * carries the physics. It is not true. Flying to a body — rather than reaching it through
   * the FSS — writes an `AutoScan` with the whole record: planet class, atmosphere, volcanism,
   * gravity, temperature, pressure, materials, composition. Reported from the field on
   * Aucoks AN-Q d6-59 BC 2, where the commander flew out, got a complete scan, and the app
   * offered no candidate species at all because of the label on it.
   *
   * Across this commander's 245 journals that gate discarded **1,223 landable bodies** whose
   * `AutoScan` carried full physics, and 142 more from `NavBeaconDetail`. So the test is what
   * the line contains, not what it is called: a planet class plus the two numbers every gate
   * needs. `Basic` scans have none of that and still fall out here, as they should.
   */
  const hasPhysics =
    typeof line.PlanetClass === "string" &&
    line.PlanetClass.trim() !== "" &&
    typeof line.SurfaceGravity === "number" &&
    typeof line.SurfaceTemperature === "number";
  if (!hasPhysics) return;

  if (
    typeof systemAddress !== "number" ||
    typeof bodyId !== "number" ||
    typeof bodyName !== "string" ||
    !bodyName.trim()
  )
    return;

  const starSystem = line.StarSystem as string;

  const wfRaw = line.WasFootfalled;

  if (store.currentSystemAddress === null || systemAddress !== store.currentSystemAddress) return;

  const scan: PlanetScan = {
    BodyName: bodyName,
    BodyID: bodyId,
    StarSystem: starSystem,
    SystemAddress: systemAddress,
    PlanetClass: line.PlanetClass as string | undefined,
    Atmosphere: line.Atmosphere as string | undefined,
    AtmosphereType: line.AtmosphereType as string | undefined,
    SurfaceGravity: line.SurfaceGravity as number | undefined,
    SurfaceTemperature: line.SurfaceTemperature as number | undefined,
    SurfacePressure: line.SurfacePressure as number | undefined,
    SemiMajorAxis: line.SemiMajorAxis as number | undefined,
    TidalLock: line.TidalLock as boolean | undefined,
    Volcanism: line.Volcanism as string | undefined,
    Landable: line.Landable as boolean | undefined,
    TerraformState: line.TerraformState as string | undefined,
    WasFootfalled: typeof wfRaw === "boolean" ? wfRaw : undefined,
    materials: line.Materials as PlanetScan["materials"],
    atmosphereComposition: line.AtmosphereComposition as PlanetScan["atmosphereComposition"],
    composition: line.Composition as PlanetScan["composition"],
    radius: line.Radius as number | undefined,
    MassEM: line.MassEM as number | undefined,
    RotationPeriod: (line as Record<string, unknown>).RotationPeriod as number | undefined,
    AxialTilt: (line as Record<string, unknown>).AxialTilt as number | undefined,
    OrbitalPeriod: (line as Record<string, unknown>).OrbitalPeriod as number | undefined,
    Eccentricity: (line as Record<string, unknown>).Eccentricity as number | undefined,
    OrbitalInclination: (line as Record<string, unknown>).OrbitalInclination as number | undefined,
    Periapsis: (line as Record<string, unknown>).Periapsis as number | undefined,
    AscendingNode: (line as Record<string, unknown>).AscendingNode as number | undefined,
    MeanAnomaly: (line as Record<string, unknown>).MeanAnomaly as number | undefined,
  };

  const b = ensureBody(
    store.bodies,
    systemAddress,
    bodyId,
    bodyName,
    starSystem ?? store.currentSystem ?? "",
    ts,
  );
  b.scan = scan;
  if (typeof starSystem === "string" && starSystem.trim()) {
    store.rememberVisitedSystem(starSystem.trim(), systemAddress);
  }
  explorationMerge.propagateExoAmongSimilarMoons(store, bodyId, systemAddress, ts, "detailed_scan");
  return;
}

/** `ScanOrganic` — one of apply()'s event handlers. */
export function onScanOrganic(store: GameStateStore, written: JournalLine, ts: string): void {
  const line = store.ownBodyForAnalyse(written);
  const systemAddress = line.SystemAddress as number;
  const bodyId = line.Body as number;
  const variant = (line.Variant_Localised as string | undefined)?.trim() ?? "";
  const genusLoc = (line.Genus_Localised as string | undefined)?.trim() ?? "";
  const genusSym = (line.Genus as string | undefined)?.trim() ?? "";
  const speciesLoc = (line.Species_Localised as string | undefined)?.trim() ?? "";
  const speciesSym = (line.Species as string | undefined)?.trim() ?? "";
  if (typeof bodyId !== "number" || typeof systemAddress !== "number" || (!variant && !speciesLoc))
    return;

  const bk = bodyKey(systemAddress, bodyId);
  if (store.exoOrganicTracker && store.exoOrganicTracker.bodyKey !== bk) {
    wipeOrganicSampleSession(store, getProjectRoot());
  }
  if (!store.exoOrganicTracker && store.footSessionBodyKey && store.footSessionBodyKey !== bk) {
    wipeOrganicSampleSession(store, getProjectRoot());
  }

  const lock: OrganicGenusLock = {
    genusLocalised: genusLoc,
    genusSymbol: genusSym,
    speciesLocalised: speciesLoc,
    speciesSymbol: speciesSym,
    variantLocalised: variant,
  };

  const speciesKey = speciesKeyFromOrganicJournal(line);
  const fullKey = `${bk}::${speciesKey}`;

  /**
   * The sampling run: first sample of a species on a body to the analyse that completes it.
   *
   * Keyed per species per body, because a commander taking two genera on one landing runs two
   * of these and they interleave.
   */
  const runScanType = typeof line.ScanType === "string" ? line.ScanType : "";
  const organicAt = Date.parse(ts);
  if (Number.isFinite(organicAt)) {
    if (runScanType === "Log" || runScanType === "Sample") {
      if (!store.organicRunStartedAt.has(fullKey)) store.organicRunStartedAt.set(fullKey, organicAt);
    } else if (runScanType === "Analyse") {
      const startedAt = store.organicRunStartedAt.get(fullKey);
      if (startedAt != null) {
        const minutes = (organicAt - startedAt) / 60_000;
        if (minutes > 0 && minutes < 90) store.samplingMinutesSamples.push(minutes);
      }
      store.organicRunStartedAt.delete(fullKey);
    }
  }

  if (journalLineCarriesPlanetMetrics(line)) {
    const lineBodyName =
      typeof line.BodyName === "string" && line.BodyName.trim()
        ? line.BodyName.trim()
        : (findRecentJournalBodyName(store, systemAddress, bodyId) ??
          store.explorationScans.get(bk)?.bodyName ??
          `Body ${bodyId}`);
    explorationMerge.mergeExplorationScan(store, { ...line, BodyID: bodyId, BodyName: lineBodyName } as JournalLine, ts);
  }

  const prevProg = store.organicAnalyseByKey.get(fullKey) ?? { count: 0, label: "" };

  const nextCountRaw = nextOrganicProgressCount(prevProg.count, line);
  if (nextCountRaw !== null) {
    const label = displayLabelFromOrganicLine(line);
    const nextCount = Math.max(prevProg.count, nextCountRaw);
    const nextLabel = label || prevProg.label;
    store.organicAnalyseByKey.set(fullKey, { count: nextCount, label: nextLabel });
    if (nextCount >= 3 && prevProg.count < 3) store.noteSampledAchievement(line, systemAddress, ts);
    if (nextCount >= 3 && !store.pendingOrganicSales.some((p) => p.fullKey === fullKey)) {
      store.pendingOrganicSales.push({
        fullKey,
        bodyKey: bk,
        speciesKey,
        label: nextLabel,
      });
    }
  }

  const scanType = (line.ScanType as string | undefined)?.trim();
  /*
   * `Log` counts, and used to be dropped.
   *
   * All three ScanOrganic types name the species — every one of this commander's 1,166 lines
   * carries `Species_Localised` — so all three are first-hand proof the species was on that
   * body. Only `Analyse` and `Sample` were recorded, which silently lost every species that
   * was logged and then left alone: 85 of 352 observations, because skipping a low-value plant
   * after logging it is a normal way to play, not an incomplete action.
   */
  const isOrganicConfirmation = scanType === "Analyse" || scanType === "Sample" || scanType === "Log";
  if (isOrganicConfirmation && (genusLoc || genusSym)) {
    const rec = store.explorationScans.get(bk);
    const exo = store.bodies.get(bk);
    const baseScan = exo?.scan ?? (rec ? planetScanFromExplorationRecord(rec) : null);
    if (baseScan?.PlanetClass?.trim()) {
      const fromPriorJournal = findRecentJournalBodyName(store, systemAddress, bodyId);
      const lineBodyName =
        typeof line.BodyName === "string" && line.BodyName.trim() ? line.BodyName.trim() : "";
      const bodyName = fromPriorJournal || lineBodyName || rec?.bodyName || `Body ${bodyId}`;
      const starSystem =
        (line.StarSystem as string | undefined)?.trim() ||
        findRecentJournalStarSystem(store, systemAddress) ||
        rec?.starSystem ||
        store.visitedSystems.get(systemAddress) ||
        "";
      try {
        recordFootScanned(getProjectRoot(), {
          systemAddress,
          bodyId,
          bodyName,
          starSystem,
          scan: baseScan,
          lock,
          ts,
          includeBacterium: store.includeBacteriumInSearch,
          confirmationSource:
            scanType === "Analyse" ? "analyse" : scanType === "Sample" ? "sample" : "log",
        });
      } catch {
        /* non-fatal: catalog file may be read-only */
      }
    }
  }

  const nameHint =
    (line.BodyName as string) ||
    store.explorationScans.get(bk)?.bodyName ||
    findRecentJournalBodyName(store, systemAddress, bodyId) ||
    `Body ${bodyId}`;
  const recForStar = store.explorationScans.get(bk);
  const starSystem =
    (line.StarSystem as string | undefined)?.trim() ||
    findRecentJournalStarSystem(store, systemAddress) ||
    recForStar?.starSystem ||
    store.visitedSystems.get(systemAddress) ||
    store.currentSystem ||
    "";

  const b = ensureBody(store.bodies, systemAddress, bodyId, nameHint, starSystem, ts);

  if (genusLoc || genusSym) {
    upsertFootOrganicLock(b.organicGenusLocks, lock, scanType ?? "", ts);
  }

  if (variant && !b.confirmedVariants.includes(variant)) {
    b.confirmedVariants.push(variant);
    store.confirmedVariantsRevision += 1;
  }
  explorationMerge.propagateExoAmongSimilarMoons(store, bodyId, systemAddress, ts, "organic");
  return;
}

/** `Embark` / `Embarked` — one of apply()'s event handlers. */
export function onEmbarkEtc(_store: GameStateStore): void {
  return;
}

/** `Disembark` / `Disembarked` — one of apply()'s event handlers. */
export function onDisembarkEtc(store: GameStateStore, line: JournalLine): void {
  const onPlanet = line.OnPlanet === true;
  const onStation = line.OnStation === true;
  const bodyId = line.BodyID as number | undefined;
  const systemAddress = line.SystemAddress as number | undefined;
  if (onPlanet && !onStation && typeof bodyId === "number" && typeof systemAddress === "number") {
    const bk = bodyKey(systemAddress, bodyId);
    const detailedSaidUnfootfalled = store.bodyDetailedFootfallState.get(bk) === false;
    /**
     * Kept for a field the journal does not currently write.
     *
     * Audited 2026-09-08 against 244 journals: `Disembark` carries `Body`, `BodyID`, `ID`,
     * `MarketID`, `Multicrew`, `OnPlanet`, `OnStation`, `SRV`, `StarSystem`, `StationName`,
     * `StationType`, `SystemAddress`, `Taxi`, `event` and `timestamp` — and nothing resembling
     * a first-footfall flag, in any casing, across 1,029 events. This half has never fired.
     *
     * Left in place rather than deleted because it costs nothing and would start working if
     * Frontier ever adds the field. Documented because two other reads of never-written fields
     * turned out to be real bugs — `WasDiscovered` on `FSDJump` and the missing `Log` scan type
     * — and the next reader needs to know this one is *known* dead rather than assumed live.
     *
     * The line above carries the feature on its own, and correctly: of 253 planet bodies this
     * commander has disembarked on, 87 had a scan saying not-footfalled, which is exactly the
     * 87 in `firstFootfallBodies`. Of the remainder, 158 were landed on before `WasFootfalled`
     * existed in the journal at all (first seen 2025-09-29), so they are unknowable rather than
     * missed.
     */
    const journalFirstFootfall = line.firstfootfall === true || line.FirstFootfall === true;
    if (detailedSaidUnfootfalled || journalFirstFootfall) {
      store.firstFootfallBodies.add(bk);
    }
    // Read the eligibility above *before* recording this: standing on the body makes it
    // footfalled from now on, and folding that in first would erase the `false` this
    // commander's own ×5 bonus depends on.
    store.observeFootfall(bk, true, "journal", (line.timestamp as string) ?? new Date().toISOString());
  }
  return;
}

/** `Died` — one of apply()'s event handlers. */
export function onDied(store: GameStateStore): void {
  // Unsold cartographic data is lost with the ship. The physics stays in the archive, and the
  // bodies are not marked sold: scanning them again earns the data back.
  explorationSales.clearExplorationDataForSystems(store, new Set([...store.explorationScans.values()].map((r) => r.systemAddress)), false);
  store.organicAnalyseByKey.clear();
  store.pendingOrganicSales = [];
  store.exoOrganicLastFix = null;
  wipeOrganicSampleSession(store, getProjectRoot());
  return;
}
