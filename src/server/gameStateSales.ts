/*
  Selling data (split out of gameState.ts, discuss item 30, 1.3.1): organic and exploration sales, the sold tallies,
  and clearing the sold systems' scans so their value leaves the unsold total.
*/
import type { ExplorationScanRecord, JournalLine } from "../shared/types.js";
import { speciesKeyFromSellBio } from "./organicTracking.js";
import { bodyKey, systemAddressOfBodyKey } from "../shared/bodyKey.js";
import type { SoldTally } from "./journalMergePayload.js";
import type { GameStateStore } from "./gameState.js";

/** `SellOrganicData` — one of apply()'s event handlers. */
export function onSellOrganicData(store: GameStateStore, line: JournalLine): void {
  const bios = line.BioData;
  if (!Array.isArray(bios)) return;
  const ts = typeof line.timestamp === "string" ? line.timestamp : "";
  for (const raw of bios) {
    if (!raw || typeof raw !== "object") continue;
    const bio = raw as Record<string, unknown>;
    const sk = speciesKeyFromSellBio(bio);
    const idx = store.pendingOrganicSales.findIndex((p) => p.speciesKey === sk);
    if (idx >= 0) {
      const [removed] = store.pendingOrganicSales.splice(idx, 1);
      if (removed) {
        store.organicAnalyseByKey.delete(removed.fullKey);
        /*
          The sale names a price but not a place, and the station is not the place: the
          credits belong to the system he walked on. The pending queue still knows which body
          the completed sample came from, and it is about to be dropped — so the attribution
          has to happen here or not at all.
        */
        const value = Number(bio.Value);
        const bonus = Number(bio.Bonus);
        const credits = (Number.isFinite(value) ? value : 0) + (Number.isFinite(bonus) ? bonus : 0);
        const addr = systemAddressOfBodyKey(removed.bodyKey);
        if (credits > 0 && Number.isFinite(addr)) {
          addSoldTally(store, store.soldOrganicBySystem, addr, credits, 1, ts);
        }
      }
    }
  }
  return;
}

/** `SellExplorationData` / `MultiSellExplorationData` — one of apply()'s event handlers. */
export function onSellExplorationDataEtc(store: GameStateStore, line: JournalLine, event: string): void {
  const o = line as Record<string, unknown>;
  // Recorded before the clear, which is what removes the rows this is attributed to.
  recordExplorationSale(store, o, event === "MultiSellExplorationData" ? o.Discovered : o.Systems);
  if (event === "SellExplorationData") clearExplorationForSoldSystems(store, o.Systems);
  else clearExplorationForSoldSystemsMulti(store, o.Discovered);
  return;
}

/**
 * Resolve journal `StarSystem` names to addresses (visited list first, then merged exploration rows),
 * for one sale. Built once per sale, not walked per sold system: each name used to lowercase every
 * system the commander ever visited (plan 2.3, Opus 21).
 */
export function systemAddressesByName(store: GameStateStore): (name: string) => number | null {
  let map: Map<string, number> | null = null;
  return (name) => {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    if (!map) {
      map = new Map();
      for (const [addr, sys] of store.visitedSystems) {
        const k = sys.trim().toLowerCase();
        if (!map.has(k)) map.set(k, addr);
      }
      for (const rec of store.explorationScans.values()) {
        const k = rec.starSystem?.trim().toLowerCase();
        if (k && !map.has(k)) map.set(k, rec.systemAddress);
      }
    }
    return map.get(n) ?? null;
  };
}

/**
 * Drop merged exploration / DSS state for a system after a cartographic sale (journal replay order),
 * or after death with `sold = false` — the data is gone either way, but only sold bodies stay out of
 * the unsold total when scanned again.
 */
export function clearExplorationDataForSystems(store: GameStateStore, systemAddresses: Iterable<number>, sold = true): void {
  const systems = new Set(systemAddresses);
  if (systems.size === 0) return;
  for (const systemAddress of systems) {
    const prefix = `${systemAddress}:`;
    const fresh = store.scanIndexIsFresh();
    const moved: { kind: "live" | "sold"; rec: ExplorationScanRecord; drop?: boolean }[] = [];
    // The system's own rows from the index when it is fresh, not a walk over every record.
    const rows = fresh
      ? [...store.liveScansInSystem(systemAddress)].map((r) => [bodyKey(r.systemAddress, r.bodyId), r] as const)
      : [...store.explorationScans.entries()].filter(([k]) => k.startsWith(prefix));
    for (const [k, rec] of rows) {
      if (sold) store.soldBodyKeys.add(k);
      // The value is sold; the physics is not. See soldExplorationScans.
      store.soldExplorationScans.set(k, rec);
      store.explorationScans.delete(k);
      store.explorationScansRevision += 1;
      moved.push({ kind: "sold", rec }, { kind: "live", rec, drop: true });
    }
    store.patchScanIndex(fresh, moved);
    store.fssAllBodiesCompleteSystems.delete(systemAddress);
    store.fssAllBodiesFoundCountBySystem.delete(systemAddress);
    store.fssDiscoveryScanBySystem.delete(systemAddress);
    const moons = store.orbitParentsInSystem(systemAddress);
    if (moons.size) {
      for (const bid of [...moons.keys()]) store.orbitParentPlanetByBody.delete(bodyKey(systemAddress, bid));
      store.orbitParentRevision += 1;
      // The index was fresh (just read): drop the system from it rather than rebuild it.
      const memo = store.orbitParentMemo!;
      memo.bySystem.delete(systemAddress);
      memo.key = store.orbitParentKey();
    }
  }
  /*
    The body-keyed sets, walked once for the whole sale (plan 2.3, Opus 21). They hold every body the
    commander ever mapped or resolved, and were walked once per sold system: a 50-system sale walked
    each of them 50 times.
  */
  const inSold = (k: string) => systems.has(Number(k.slice(0, k.indexOf(":"))));
  for (const k of [...store.dssMappedBodyKeys]) {
    if (inSold(k)) {
      store.dssMappedBodyKeys.delete(k);
      store.archivedDssMappedBodyKeys.add(k);
    }
  }
  for (const k of [...store.dssFirstMapperEligibleByBodyKey.keys()]) {
    if (inSold(k)) store.dssFirstMapperEligibleByBodyKey.delete(k);
  }
  for (const k of [...store.dssMappingEfficientByBodyKey.keys()]) {
    if (inSold(k)) store.dssMappingEfficientByBodyKey.delete(k);
  }
  for (const k of [...store.fssBodySignalsBodyKeys]) {
    if (inSold(k)) store.fssBodySignalsBodyKeys.delete(k);
  }
}

/** Add to a per-system tally, keeping the latest timestamp. */
export function addSoldTally(
  store: GameStateStore,
  map: Map<number, SoldTally>,
  systemAddress: number,
  credits: number,
  items: number,
  at: string,
): void {
  const cur = map.get(systemAddress) ?? { credits: 0, items: 0, sales: 0, lastAt: "" };
  cur.credits += credits;
  cur.items += items;
  cur.sales += 1;
  if (at > cur.lastAt) cur.lastAt = at;
  map.set(systemAddress, cur);
}

/**
 * Credit an exploration sale to the systems it covered.
 *
 * The journal gives one `TotalEarnings` for the whole batch and, at best, a body count per system.
 * So the money is **apportioned by body count** — twice the bodies, twice the credits — and where
 * no counts are given it is split evenly. This is an estimate of a real payment rather than a
 * real per-system payment, and the panel that shows it says so.
 *
 * `TotalEarnings` is preferred over `BaseValue + Bonus` because it is what actually arrived: the
 * other two are the pre-discount figures and do not always sum to it.
 */
export function recordExplorationSale(store: GameStateStore, line: Record<string, unknown>, listed: unknown): void {
  if (!Array.isArray(listed) || listed.length === 0) return;
  const total = Number(line.TotalEarnings);
  const fallback = Number(line.BaseValue) + Number(line.Bonus);
  const earned = Number.isFinite(total) && total > 0 ? total : Number.isFinite(fallback) ? fallback : 0;
  if (!(earned > 0)) return;
  const ts = typeof line.timestamp === "string" ? line.timestamp : "";

  const rows: { addr: number; bodies: number }[] = [];
  const byName = systemAddressesByName(store);
  for (const item of listed) {
    let addr: number | null = null;
    let bodies = 0;
    if (typeof item === "string") {
      addr = byName(item);
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.SystemAddress === "number" && Number.isFinite(o.SystemAddress)) addr = o.SystemAddress;
      else {
        const nm = o.SystemName ?? o.StarSystem ?? o.System;
        if (typeof nm === "string") addr = byName(nm);
      }
      const n = Number(o.NumBodies);
      if (Number.isFinite(n) && n > 0) bodies = n;
    }
    if (addr != null) rows.push({ addr, bodies });
  }
  if (rows.length === 0) return;

  const totalBodies = rows.reduce((n, r) => n + r.bodies, 0);
  for (const r of rows) {
    const share = totalBodies > 0 ? r.bodies / totalBodies : 1 / rows.length;
    addSoldTally(store, store.soldExplorationBySystem, r.addr, earned * share, r.bodies, ts);
  }
}

/** `SellExplorationData.Systems` — string names and/or objects with SystemAddress / SystemName. */
export function clearExplorationForSoldSystems(store: GameStateStore, systems: unknown): void {
  if (!Array.isArray(systems)) return;
  const byName = systemAddressesByName(store);
  const sold: number[] = [];
  for (const item of systems) {
    if (typeof item === "string") {
      const addr = byName(item);
      if (addr != null) sold.push(addr);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.SystemAddress === "number" && Number.isFinite(o.SystemAddress)) {
      sold.push(o.SystemAddress);
      continue;
    }
    const nm = o.SystemName ?? o.StarSystem ?? o.System;
    if (typeof nm === "string") {
      const addr = byName(nm);
      if (addr != null) sold.push(addr);
    }
  }
  clearExplorationDataForSystems(store, sold);
}

/** `MultiSellExplorationData.Discovered` — { SystemName, NumBodies }[] (optional SystemAddress). */
export function clearExplorationForSoldSystemsMulti(store: GameStateStore, discovered: unknown): void {
  if (!Array.isArray(discovered)) return;
  const byName = systemAddressesByName(store);
  const sold: number[] = [];
  for (const item of discovered) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.SystemAddress === "number" && Number.isFinite(o.SystemAddress)) {
      sold.push(o.SystemAddress);
      continue;
    }
    const nm = o.SystemName;
    if (typeof nm === "string") {
      const addr = byName(nm);
      if (addr != null) sold.push(addr);
    }
  }
  clearExplorationDataForSystems(store, sold);
}
