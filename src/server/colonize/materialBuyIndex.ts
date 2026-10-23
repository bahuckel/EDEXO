import { promises as fs } from "node:fs";
import path from "node:path";
import { backupUnreadableJson, writeJsonAtomic } from "./jsonFs";
import { buyStationHitMatchesNeed } from "../../shared/colonize/buyStationHitMatch";
import { commodityIdsEquivalent, commodityNeedMatchesLabel, commodityNormKey } from "../../shared/colonize/commodityKey";
import type { BuyIndexStationMaterial, BuyIndexStationResult, BuyIndexSystemResult } from "../../shared/colonize/buyIndexSearchTypes";
import { materialNeedsFromQuery } from "../../shared/colonize/buyIndexSearchQuery";
import { orderHitsByDijkstraReach } from "../../shared/colonize/dijkstraStationReach";
import { constructionHopLy, lyOrLast, nearerLy, type Ly } from "../../shared/colonize/systemDistanceLy";
import { isConstructionDepotStation, type ConstructionDepotRef } from "../../shared/colonize/constructionDepot";
import { isCommanderBuyOffer } from "../../shared/colonize/stationSellOffer";
import { hasBuyStationWithinLy } from "../../shared/colonize/buyStationNearby";
import { LIVE_SCAN_NEARBY_LY, normSystemName } from "../../shared/colonize/stationFilter";
import { buyStationPlaceKey, dedupeBuyStationHits, mergeBuyStationHits } from "../../shared/colonize/buyStationMerge";
import { pruneBuyIndexBySources } from "../../shared/colonize/buyIndexClear";
import { sortStationsByHop, sortSystemsByHop } from "../../shared/colonize/buyIndexSort";
import type { CheckoutOfferSource } from "../../shared/colonize/types";
import type { MaterialBuyIndexFile, MaterialBuyIndexRow, MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";

const INDEX_FILENAME = "material-buy-index.json";
const INDEX_VERSION = 3;
/** A single remembered station usually means a truncated Spansh recall — keep scanning until we have more. */
const MATERIAL_BUY_MIN_STATIONS_FOR_FRESH = 2;
const MAX_STATIONS_PER_COMMODITY = 80;
/** Re-use cached stations without live Spansh for this long. */
export const MATERIAL_BUY_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type IndexedStationHit = { hit: MaterialBuyStationHit; commodityId: string };

type RefSnapshot = {
  rows: MaterialBuyIndexRow[];
  rowById: Map<string, MaterialBuyIndexRow>;
  hitsByStation: Map<string, IndexedStationHit[]>;
};

function sortHits(a: MaterialBuyStationHit, b: MaterialBuyStationHit): number {
  const da = lyOrLast(a.distanceLy);
  const db = lyOrLast(b.distanceLy);
  if (da !== db) return da - db;
  return a.stationName.localeCompare(b.stationName);
}

function rowMatchesNeed(row: MaterialBuyIndexRow, commodityId: string, label: string): boolean {
  if (commodityId && (row.commodityId === commodityId || commodityIdsEquivalent(row.commodityId, commodityId))) {
    return true;
  }
  return commodityNeedMatchesLabel(commodityId, label, row.label);
}

/** Hit must match this SKU by spansh/journal label — never trust row bucket alone. */
function hitMatchesNeed(hit: MaterialBuyStationHit, commodityId: string, label: string): boolean {
  return buyStationHitMatchesNeed(commodityId, label, hit);
}

function rowIdsForNeed(snap: RefSnapshot, commodityId: string, label: string): Set<string> {
  const rowIds = new Set<string>();
  if (commodityId) {
    rowIds.add(commodityId);
    if (snap.rowById.has(commodityId)) return rowIds;
  }
  for (const row of snap.rows) {
    if (rowMatchesNeed(row, commodityId, label)) rowIds.add(row.commodityId);
  }
  return rowIds;
}

/** Station sells to commander — reject demand-only rows (supply without a sell price). */
function isValidSellHit(h: MaterialBuyStationHit): boolean {
  if (!h.stationName?.trim() || !h.systemName?.trim()) return false;
  return isCommanderBuyOffer(h.supply, h.buyPrice);
}

function rememberLocalHit(h: MaterialBuyStationHit): MaterialBuyStationHit | null {
  return isValidSellHit(h) ? h : null;
}

function collectHitsForRowIds(
  snap: RefSnapshot,
  rowIds: Set<string>,
  commodityId: string,
  label: string,
): MaterialBuyStationHit[] {
  if (!rowIds.size) return [];
  const hits = new Map<string, MaterialBuyStationHit>();
  for (const rowId of rowIds) {
    const row = snap.rowById.get(rowId);
    if (!row || !rowMatchesNeed(row, commodityId, label)) continue;
    for (const raw of row.stations) {
      if (!hitMatchesNeed(raw, commodityId, label)) continue;
      const h = rememberLocalHit(raw);
      if (!h) continue;
      const k = buyStationPlaceKey(h);
      const prev = hits.get(k);
      hits.set(k, prev ? mergeBuyStationHits(prev, h) : h);
    }
  }
  return [...hits.values()].sort(sortHits);
}

export class MaterialBuyIndex {
  private filePath: string;
  private data: MaterialBuyIndexFile = { version: INDEX_VERSION, systems: {} };
  private loaded = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private snapshots = new Map<string, RefSnapshot>();
  private rowIdsCache = new Map<string, Set<string>>();
  private hitsCache = new Map<string, MaterialBuyStationHit[]>();
  /** True after sanitizeSellHits ran against the current data — skips redundant full passes per checkout. */
  private sanitized = false;
  /** Depot signature of the last purge — skips redundant full-index passes per checkout/scan. */
  private lastPurgeSig: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private savePending = false;
  /** Incremented by every `mergeStations`; see `mergeGeneration`. */
  private mergeGen = 0;
  /** Shared by every concurrent `load()` so the file is read once. */
  private loadPromise: Promise<void> | null = null;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, INDEX_FILENAME);
  }

  /**
   * Startup calls this concurrently from IPC bootstrap, the Inara watcher, and any
   * early handler. `loaded` used to be set only after the await, so a second caller
   * passed the guard and reassigned `this.data` on top of merges the first had already
   * applied — Inara imports arriving during startup were dropped. One in-flight promise
   * is shared by every caller instead.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.loadPromise ??= this.readFromDisk().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async readFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as MaterialBuyIndexFile;
      if (parsed?.version === INDEX_VERSION && parsed.systems && typeof parsed.systems === "object") {
        this.data = parsed;
      } else {
        /**
         * An index this build cannot read is about to be replaced by the next save. Keep a copy:
         * rebuilding it means re-scanning Spansh or re-importing every Inara scrape by hand.
         */
        await backupUnreadableJson(this.filePath, parsed?.version ?? "unknown");
      }
    } catch (e) {
      // A file that is there but does not parse holds Inara imports nobody can fetch again: keep a copy.
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") await backupUnreadableJson(this.filePath, "corrupt");
      this.data = { version: INDEX_VERSION, systems: {} };
    }
    this.loaded = true;
    this.sanitized = false;
    this.lastPurgeSig = null;
    this.snapshots.clear();
    this.rowIdsCache.clear();
    this.hitsCache.clear();
  }

  /**
   * Coalesce disk writes: stringifying the whole index is a main-thread stall, and scans
   * call mergeStations once per commodity. One write ~2.5s after the last merge (or on flush).
   */
  private queueSave(): void {
    this.savePending = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.startPendingSave();
    }, 2500);
  }

  private startPendingSave(): void {
    if (!this.savePending) return;
    this.savePending = false;
    this.saveQueue = this.saveQueue.then(async () => {
      await writeJsonAtomic(this.filePath, this.data, false);
    });
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.startPendingSave();
    await this.saveQueue;
  }

  async clearAll(): Promise<void> {
    this.data = { version: INDEX_VERSION, systems: {} };
    this.loaded = true;
    this.sanitized = true;
    this.lastPurgeSig = null;
    this.snapshots.clear();
    this.rowIdsCache.clear();
    this.hitsCache.clear();
    await this.flush();
  }

  async clearBySources(sources: CheckoutOfferSource[], dropRefKeys: string[] = []): Promise<number> {
    await this.load();
    const { systems, removedHits } = pruneBuyIndexBySources(this.data.systems, new Set(sources), dropRefKeys);
    this.data = { version: INDEX_VERSION, systems };
    this.sanitized = false;
    this.lastPurgeSig = null;
    this.snapshots.clear();
    this.rowIdsCache.clear();
    this.hitsCache.clear();
    await this.flush();
    return removedHits;
  }

  refKey(referenceSystem: string): string {
    return normSystemName(referenceSystem);
  }

  /**
   * Row ids for a need are read from one reference's own rows, so only that reference's entries
   * go. Hits are merged across every reference, so a merge anywhere can change any of them and
   * that cache still has to go whole.
   */
  private invalidateSnapshot(referenceSystem: string): void {
    const ref = this.refKey(referenceSystem);
    this.snapshots.delete(ref);
    const prefix = `${ref}\0`;
    for (const key of this.rowIdsCache.keys()) {
      if (key.startsWith(prefix)) this.rowIdsCache.delete(key);
    }
    this.hitsCache.clear();
  }

  private rowIdsCacheKey(commodityId: string, label: string): string {
    return `${commodityNormKey(commodityId)}\0${commodityNormKey(label)}`;
  }

  private cachedRowIdsForNeed(referenceSystem: string, commodityId: string, label: string): Set<string> {
    const key = `${this.refKey(referenceSystem)}\0${this.rowIdsCacheKey(commodityId, label)}`;
    const hit = this.rowIdsCache.get(key);
    if (hit) return hit;
    const rowIds = rowIdsForNeed(this.snapshotFor(referenceSystem), commodityId, label);
    this.rowIdsCache.set(key, rowIds);
    return rowIds;
  }

  allReferenceKeys(): string[] {
    return Object.keys(this.data.systems);
  }

  /** Cached view — one pass over the JSON index per reference system. */
  snapshotForRefKey(refKey: string): RefSnapshot {
    const ref = normSystemName(refKey);
    const cached = this.snapshots.get(ref);
    if (cached) return cached;

    const sys = this.data.systems[ref];
    const rows = sys ? Object.values(sys) : [];
    const rowById = new Map<string, MaterialBuyIndexRow>();
    const hitsByStation = new Map<string, IndexedStationHit[]>();

    for (const row of rows) {
      rowById.set(row.commodityId, row);
      for (const hit of row.stations) {
        if (!isValidSellHit(hit)) continue;
        const k = buyStationPlaceKey(hit);
        const list = hitsByStation.get(k) ?? [];
        list.push({ hit, commodityId: row.commodityId });
        hitsByStation.set(k, list);
      }
    }

    const snap: RefSnapshot = { rows, rowById, hitsByStation };
    this.snapshots.set(ref, snap);
    return snap;
  }

  snapshotFor(referenceSystem: string): RefSnapshot {
    return this.snapshotForRefKey(this.refKey(referenceSystem));
  }

  getRow(referenceSystem: string, commodityId: string): MaterialBuyIndexRow | null {
    return this.snapshotFor(referenceSystem).rowById.get(commodityId) ?? null;
  }

  isFresh(referenceSystem: string, commodityId: string, ttlMs = MATERIAL_BUY_CACHE_TTL_MS): boolean {
    const row = this.getRow(referenceSystem, commodityId);
    if (!row?.stations?.length) return false;
    if (row.stations.length < MATERIAL_BUY_MIN_STATIONS_FOR_FRESH) return false;
    const t = Date.parse(row.updatedAtIso);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < ttlMs;
  }

  /** Distinct seller star systems saved for this SKU near a construction ref (stations in the same system count once). */
  countDistinctSystemsForNeed(
    referenceSystem: string,
    commodityId: string,
    label = "",
    constructionDepots: ConstructionDepotRef[] = [],
  ): number {
    const hits = this.getAllStationsForNeed(
      referenceSystem,
      commodityId,
      label,
      {},
      referenceSystem,
      constructionDepots,
    );
    const systems = new Set<string>();
    for (const h of hits) {
      const sys = normSystemName(h.systemName);
      if (sys) systems.add(sys);
    }
    return systems.size;
  }

  /** True while saved index has fewer than maxSystems distinct seller systems for this material. */
  needsMoreSystems(
    referenceSystem: string,
    commodityId: string,
    label: string,
    maxSystems: number,
    constructionDepots: ConstructionDepotRef[] = [],
  ): boolean {
    if (!Number.isFinite(maxSystems) || maxSystems <= 0) return true;
    return this.countDistinctSystemsForNeed(referenceSystem, commodityId, label, constructionDepots) < maxSystems;
  }

  needsPassiveScan(
    referenceSystem: string,
    commodityId: string,
    ttlMs = MATERIAL_BUY_CACHE_TTL_MS,
    maxSystems: number | null = null,
    label = "",
    constructionDepots: ConstructionDepotRef[] = [],
  ): boolean {
    if (maxSystems != null && maxSystems > 0) {
      if (!this.needsMoreSystems(referenceSystem, commodityId, label, maxSystems, constructionDepots)) {
        return false;
      }
    }
    const row = this.getRow(referenceSystem, commodityId);
    if (!row?.stations?.length) return true;
    if (row.stations.length < MATERIAL_BUY_MIN_STATIONS_FOR_FRESH) return true;
    return !this.isFresh(referenceSystem, commodityId, ttlMs);
  }

  /** Every SKU across all refs is at the system cap — background Spansh can stop. */
  allMaterialsAtSystemCap(
    referenceSystems: string[],
    items: Array<{ id: string; label: string }>,
    maxSystems: number,
    constructionDepots: ConstructionDepotRef[] = [],
  ): boolean {
    if (!Number.isFinite(maxSystems) || maxSystems <= 0) return false;
    for (const ref of referenceSystems) {
      const t = ref.trim();
      if (!t) continue;
      for (const item of items) {
        if (!item.id) continue;
        if (this.needsMoreSystems(t, item.id, item.label, maxSystems, constructionDepots)) return false;
      }
    }
    return true;
  }

  /** Every missing SKU has at least one buy station within scan range — no further Spansh needed. */
  allMaterialsHaveBuyStations(
    referenceSystems: string[],
    items: Array<{ id: string; label: string }>,
    constructionDepots: ConstructionDepotRef[] = [],
  ): boolean {
    if (!items.length) return false;
    for (const ref of referenceSystems) {
      const t = ref.trim();
      if (!t) continue;
      for (const item of items) {
        if (!item.id) continue;
        const hits = this.getAllStationsForNeed(t, item.id, item.label, {}, t, constructionDepots);
        if (!hasBuyStationWithinLy(hits, LIVE_SCAN_NEARBY_LY, {}, t)) return false;
      }
    }
    return true;
  }

  getStations(referenceSystem: string, commodityId: string): MaterialBuyStationHit[] {
    const row = this.getRow(referenceSystem, commodityId);
    if (!row) return [];
    return row.stations.filter((h) => isValidSellHit(h)).sort(sortHits);
  }

  getStationsForNeed(referenceSystem: string, commodityId: string, label = ""): MaterialBuyStationHit[] {
    const snap = this.snapshotFor(referenceSystem);
    return collectHitsForRowIds(snap, rowIdsForNeed(snap, commodityId, label), commodityId, label);
  }

  /** Every saved seller for this SKU across all construction refs — local ref hits first. */
  getAllStationsForNeed(
    referenceSystem: string,
    commodityId: string,
    label = "",
    distanceBySystem: Record<string, number> = {},
    distanceOrigin?: string,
    constructionDepots: ConstructionDepotRef[] = [],
  ): MaterialBuyStationHit[] {
    const distRef = distanceOrigin?.trim() || referenceSystem;
    const cacheKey = `${this.refKey(referenceSystem)}\0${this.rowIdsCacheKey(commodityId, label)}`;

    const localRef = this.refKey(referenceSystem);
    const rowIds = this.cachedRowIdsForNeed(referenceSystem, commodityId, label);
    if (!rowIds.size) return [];

    const localHits = new Map<string, MaterialBuyStationHit>();
    const remoteHits = new Map<string, MaterialBuyStationHit>();
    for (const ref of this.allReferenceKeys()) {
      const snap = this.snapshotForRefKey(ref);
      const bucket = ref === localRef ? localHits : remoteHits;
      for (const h of collectHitsForRowIds(snap, rowIds, commodityId, label)) {
        if (
          constructionDepots.length &&
          isConstructionDepotStation(constructionDepots, {
            systemName: h.systemName,
            stationName: h.stationName,
            marketId: h.marketId,
          })
        ) {
          continue;
        }
        const k = buyStationPlaceKey(h);
        const prev = bucket.get(k);
        bucket.set(k, prev ? mergeBuyStationHits(prev, h) : h);
      }
    }

    const useDijkstra = Object.keys(distanceBySystem).length > 0;
    const applyHop = (h: MaterialBuyStationHit): MaterialBuyStationHit => {
      const distanceLy = constructionHopLy(distRef, h.systemName, distanceBySystem);
      return distanceLy === h.distanceLy ? h : { ...h, distanceLy };
    };
    const order = (hits: MaterialBuyStationHit[]) => {
      const enriched = hits.map(applyHop);
      return useDijkstra
        ? orderHitsByDijkstraReach(distRef, enriched, distanceBySystem)
        : [...enriched].sort(sortHits);
    };
    if (!useDijkstra) {
      const cached = this.hitsCache.get(cacheKey);
      if (cached) return cached;
    }
    const merged = new Map<string, MaterialBuyStationHit>();
    for (const h of [...localHits.values(), ...remoteHits.values()]) {
      const k = buyStationPlaceKey(h);
      const prev = merged.get(k);
      merged.set(k, prev ? mergeBuyStationHits(prev, h) : h);
    }
    const out = order([...merged.values()]);
    if (!useDijkstra) this.hitsCache.set(cacheKey, out);
    return out;
  }

  /**
   * PERF-M6. This asked `getAllStationsForNeed` once per reference, and that scans every
   * reference itself — O(refs²) per need, per checkout. The answer is the same as: take the rows
   * any reference would match for this need, and look for one valid hit under them anywhere.
   */
  hasCheckoutDataAnyRef(commodityId: string, label = ""): boolean {
    const refs = this.allReferenceKeys();
    const rowIds = new Set<string>();
    for (const ref of refs) {
      for (const id of this.cachedRowIdsForNeed(ref, commodityId, label)) rowIds.add(id);
    }
    if (!rowIds.size) return false;
    for (const ref of refs) {
      if (collectHitsForRowIds(this.snapshotForRefKey(ref), rowIds, commodityId, label).length > 0) return true;
    }
    return false;
  }

  /** Drop invalid rows from disk (demand mis-tagged as supply, commodity mismatches). */
  sanitizeSellHits(): number {
    // Result can't change unless new rows were merged or the file was reloaded.
    if (this.sanitized) return 0;
    this.sanitized = true;
    let removed = 0;
    for (const ref of Object.keys(this.data.systems)) {
      const sys = this.data.systems[ref];
      if (!sys) continue;
      for (const rowId of Object.keys(sys)) {
        const row = sys[rowId];
        if (!row) continue;
        const kept = row.stations.filter((h) => {
          const drop = !isValidSellHit(h) || !hitMatchesNeed(h, row.commodityId, row.label);
          if (drop) removed += 1;
          return !drop;
        });
        const deduped = dedupeBuyStationHits(kept).sort(sortHits);
        removed += Math.max(0, kept.length - deduped.length);
        // Not a scan: the row keeps its scan time, or weeks-old data looks fresh and the next look waits 14 days.
        if (deduped.length !== row.stations.length) row.stations = deduped;
        if (!row.stations.length) delete sys[rowId];
      }
    }
    if (removed > 0) {
      this.snapshots.clear();
      this.rowIdsCache.clear();
      this.hitsCache.clear();
      this.queueSave();
    }
    return removed;
  }

  private static purgeSig(depots: ConstructionDepotRef[]): string {
    return depots
      .map((d) => `${d.marketId ?? ""}|${d.starSystem ?? d.systemName ?? ""}|${d.stationName ?? ""}|${d.constructionSiteLabel ?? d.label ?? ""}`)
      .sort()
      .join("\n");
  }

  /** Remove construction depots from saved index — they accept deliveries, never sell. */
  purgeConstructionDepotStations(depots: ConstructionDepotRef[]): number {
    if (!depots.length) return 0;
    // Idempotent for unchanged data + depots — skip the full-index pass on repeat checkouts.
    const sig = MaterialBuyIndex.purgeSig(depots);
    if (sig === this.lastPurgeSig) return 0;
    let removed = 0;
    for (const ref of Object.keys(this.data.systems)) {
      const sys = this.data.systems[ref];
      if (!sys) continue;
      for (const rowId of Object.keys(sys)) {
        const row = sys[rowId];
        if (!row) continue;
        const kept = row.stations.filter((h) => {
          const drop =
            isConstructionDepotStation(depots, {
              systemName: h.systemName,
              stationName: h.stationName,
              marketId: h.marketId,
            }) || !hitMatchesNeed(h, row.commodityId, row.label);
          if (drop) removed += 1;
          return !drop;
        });
        if (kept.length !== row.stations.length) row.stations = kept; // keeps its scan time (sanitizeSellHits)
        if (!row.stations.length) delete sys[rowId];
      }
    }
    this.lastPurgeSig = sig;
    if (removed > 0) {
      this.snapshots.clear();
      this.rowIdsCache.clear();
      this.hitsCache.clear();
      this.queueSave();
    }
    return removed;
  }

  hitsGroupedByStation(referenceSystem: string): Map<string, IndexedStationHit[]> {
    return this.snapshotFor(referenceSystem).hitsByStation;
  }

  hasCheckoutData(referenceSystem: string, commodityId: string, label = ""): boolean {
    return this.getAllStationsForNeed(referenceSystem, commodityId, label).length > 0;
  }

  mergeStations(
    referenceSystem: string,
    commodityId: string,
    label: string,
    incoming: MaterialBuyStationHit[],
  ): MaterialBuyIndexRow {
    const ref = this.refKey(referenceSystem);
    if (!this.data.systems[ref]) this.data.systems[ref] = {};
    const prev = this.data.systems[ref][commodityId];
    const byKey = new Map<string, MaterialBuyStationHit>();
    for (const h of prev?.stations ?? []) byKey.set(buyStationPlaceKey(h), h);
    for (const h of incoming) {
      if (!isValidSellHit(h)) continue;
      if (!hitMatchesNeed(h, commodityId, label)) continue;
      const k = buyStationPlaceKey(h);
      const old = byKey.get(k);
      byKey.set(k, old ? mergeBuyStationHits(old, h) : h);
    }
    const stations = [...byKey.values()].sort(sortHits).slice(0, MAX_STATIONS_PER_COMMODITY);
    const row: MaterialBuyIndexRow = {
      commodityId,
      label: label.trim() || prev?.label || commodityId,
      updatedAtIso: new Date().toISOString(),
      stations,
    };
    this.data.systems[ref][commodityId] = row;
    this.sanitized = false;
    this.lastPurgeSig = null;
    this.mergeGen++;
    this.invalidateSnapshot(referenceSystem);
    this.queueSave();
    return row;
  }

  /**
   * Bumped on every merge. Callers that memoize results derived from the index (the checkout
   * memo) key on this, so a scan landing new stations invalidates their cache immediately
   * instead of being masked until the memo expires.
   */
  mergeGeneration(): number {
    return this.mergeGen;
  }

  allRowsForReference(referenceSystem: string): MaterialBuyIndexRow[] {
    return this.snapshotFor(referenceSystem).rows;
  }

  /** Systems with saved sellers for a material (or comma-separated AND list). */
  searchSystemsForMaterial(query: string): BuyIndexSystemResult[] {
    const stations = this.searchStationsForMaterials(query);
    type Acc = {
      stationKeys: Set<string>;
      minLy: Ly;
      bestPrice: number | null;
      label: string;
    };
    const systems = new Map<string, Acc>();
    const needs = materialNeedsFromQuery(query);

    for (const st of stations) {
      const sys = st.systemName.trim();
      if (!sys) continue;
      const sk = buyStationPlaceKey(st);
      let acc = systems.get(sys);
      if (!acc) {
        acc = {
          stationKeys: new Set(),
          minLy: null,
          bestPrice: null,
          label: needs.map((n) => n.needLabel).join(", "),
        };
        systems.set(sys, acc);
      }
      acc.stationKeys.add(sk);
      acc.minLy = nearerLy(acc.minLy, st.minDistanceLy);
    }

    return [...systems.entries()]
      .map(([systemName, acc]) => ({
        systemName,
        stationCount: acc.stationKeys.size,
        minDistanceLy: acc.minLy,
        bestBuyPrice: acc.bestPrice,
        resolvedLabel: acc.label,
      }))
      .sort(sortSystemsByHop);
  }

  /** Saved sellers for one depot SKU — same scan as Search (all refs, row label match). */
  getMaterialHitsForNeed(commodityId: string, label = ""): MaterialBuyStationHit[] {
    const map = this.collectStationsForMaterialNeed({ needId: commodityId, needLabel: label }, null);
    const out: MaterialBuyStationHit[] = [];
    for (const acc of map.values()) {
      if (!isValidSellHit(acc.hit)) continue;
      out.push(acc.hit);
    }
    return out.sort(sortHits);
  }

  /** Stations (optionally in one system) that sell every material in a comma-separated query. */
  searchStationsForMaterials(materialQuery: string, systemName?: string): BuyIndexStationResult[] {
    const needs = materialNeedsFromQuery(materialQuery);
    if (!needs.length) return [];
    const sysNorm = systemName?.trim() ? normSystemName(systemName) : null;

    const maps = needs.map((need) => this.collectStationsForMaterialNeed(need, sysNorm));
    if (!maps.length) return [];
    const keys = [...maps[0]!.keys()].filter((k) => maps.every((m) => m.has(k)));

    const out: BuyIndexStationResult[] = [];
    for (const k of keys) {
      const acc = maps[0]!.get(k)!;
      for (let i = 1; i < maps.length; i++) {
        const other = maps[i]!.get(k)!;
        for (const c of other.commodities) acc.commodities.add(c);
        acc.minLy = nearerLy(acc.minLy, other.hit.distanceLy);
      }
      out.push(this.stationAccToResult(acc));
    }
    return out.sort(sortStationsByHop);
  }

  private collectStationsForMaterialNeed(
    need: { needId: string; needLabel: string },
    sysNorm: string | null,
  ): Map<string, { hit: MaterialBuyStationHit; commodities: Set<string>; minLy: Ly }> {
    type Acc = { hit: MaterialBuyStationHit; commodities: Set<string>; minLy: Ly };
    const stations = new Map<string, Acc>();

    for (const ref of this.allReferenceKeys()) {
      const snap = this.snapshotForRefKey(ref);
      for (const row of snap.rows) {
        if (!rowMatchesNeed(row, need.needId, need.needLabel)) continue;
        for (const raw of row.stations) {
          if (!isValidSellHit(raw)) continue;
          if (
            !hitMatchesNeed(raw, need.needId, need.needLabel) &&
            !hitMatchesNeed(raw, row.commodityId, row.label)
          ) {
            continue;
          }
          if (sysNorm && normSystemName(raw.systemName) !== sysNorm) continue;
          const sk = buyStationPlaceKey(raw);
          let acc = stations.get(sk);
          if (!acc) {
            acc = { hit: raw, commodities: new Set(), minLy: null };
            stations.set(sk, acc);
          } else {
            acc.hit = mergeBuyStationHits(acc.hit, raw);
          }
          acc.commodities.add(row.commodityId);
          acc.minLy = nearerLy(acc.minLy, raw.distanceLy);
        }
      }
    }
    return stations;
  }

  private stationAccToResult(acc: {
    hit: MaterialBuyStationHit;
    commodities: Set<string>;
    minLy: Ly;
  }): BuyIndexStationResult {
    return {
      systemName: acc.hit.systemName,
      stationName: acc.hit.stationName,
      marketId: acc.hit.marketId,
      bodyName: acc.hit.bodyName ?? null,
      stationType: acc.hit.stationType ?? null,
      isPlanetaryOrGround: Boolean(acc.hit.isPlanetaryOrGround),
      materialCount: acc.commodities.size,
      minDistanceLy: acc.minLy,
    };
  }

  searchStationsForMaterialInSystem(systemName: string, materialQuery: string): BuyIndexStationResult[] {
    return this.searchStationsForMaterials(materialQuery, systemName);
  }

  /** Saved stations in systems matching the query (partial name ok). */
  searchStationsInSystem(systemQuery: string): BuyIndexStationResult[] {
    const q = systemQuery.trim();
    if (!q) return [];
    const qNorm = normSystemName(q);
    const qLower = q.toLowerCase();
    type Acc = {
      hit: MaterialBuyStationHit;
      commodities: Set<string>;
      minLy: Ly;
    };
    const stations = new Map<string, Acc>();

    const systemMatches = (sys: string) => {
      const n = normSystemName(sys);
      if (qNorm && n === qNorm) return true;
      if (qNorm && n.includes(qNorm)) return true;
      return sys.toLowerCase().includes(qLower);
    };

    for (const ref of this.allReferenceKeys()) {
      const snap = this.snapshotForRefKey(ref);
      for (const row of snap.rows) {
        for (const raw of row.stations) {
          if (!isValidSellHit(raw)) continue;
          if (!hitMatchesNeed(raw, row.commodityId, row.label)) continue;
          const sys = raw.systemName.trim();
          if (!sys || !systemMatches(sys)) continue;
          const sk = buyStationPlaceKey(raw);
          let acc = stations.get(sk);
          if (!acc) {
            acc = { hit: raw, commodities: new Set(), minLy: null };
            stations.set(sk, acc);
          } else {
            acc.hit = mergeBuyStationHits(acc.hit, raw);
          }
          acc.commodities.add(row.commodityId);
          acc.minLy = nearerLy(acc.minLy, raw.distanceLy);
        }
      }
    }

    return [...stations.values()]
      .map((acc) => ({
        systemName: acc.hit.systemName,
        stationName: acc.hit.stationName,
        marketId: acc.hit.marketId,
        bodyName: acc.hit.bodyName ?? null,
        stationType: acc.hit.stationType ?? null,
        isPlanetaryOrGround: Boolean(acc.hit.isPlanetaryOrGround),
        materialCount: acc.commodities.size,
        /** Unknown used to become 0 here — "in this very system" — for any station nobody had measured. */
        minDistanceLy: acc.minLy,
      }))
      .sort((a, b) => a.stationName.localeCompare(b.stationName));
  }

  /** All commodities saved for a station (deduped across construction refs). */
  getStationCatalog(
    systemName: string,
    stationName: string,
    marketId?: string | null,
  ): BuyIndexStationMaterial[] {
    const sys = systemName.trim();
    const st = stationName.trim();
    if (!sys || !st) return [];
    const keys = new Set<string>();
    const mid = marketId?.trim();
    if (mid) keys.add(`m:${mid}`);
    keys.add(`s:${normSystemName(sys)}:${st.toLowerCase()}`);

    const byCommodity = new Map<string, BuyIndexStationMaterial>();

    for (const ref of this.allReferenceKeys()) {
      const snap = this.snapshotForRefKey(ref);
      for (const key of keys) {
        const list = snap.hitsByStation.get(key);
        if (!list) continue;
        for (const { hit, commodityId } of list) {
          if (!isValidSellHit(hit)) continue;
          if (!hitMatchesNeed(hit, commodityId, snap.rowById.get(commodityId)?.label ?? commodityId)) continue;
          const row = snap.rowById.get(commodityId);
          const label = row?.label?.trim() || hit.spanshCommodity || commodityId;
          const prev = byCommodity.get(commodityId);
          if (!prev || (hit.buyPrice != null && (prev.buyPrice == null || hit.buyPrice < prev.buyPrice))) {
            byCommodity.set(commodityId, {
              commodityId,
              label,
              buyPrice: hit.buyPrice,
              supply: hit.supply,
              distanceLy: hit.distanceLy,
              hit,
            });
          }
        }
      }
    }

    return [...byCommodity.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
}

let singleton: MaterialBuyIndex | null = null;

export function getMaterialBuyIndex(userDataDir: string): MaterialBuyIndex {
  if (!singleton) singleton = new MaterialBuyIndex(userDataDir);
  return singleton;
}
