import type { CheckoutFilters, BasketCheckoutItem } from "../../shared/colonize/types";
import { basketItemId as itemCommodityId, itemLabel as itemCommodityLabel } from "../../shared/colonize/commodityKey";
import { resolveSpanshReferenceSystem } from "./galaxySystemCoords";
import { MaterialBuyIndex, MATERIAL_BUY_CACHE_TTL_MS } from "./materialBuyIndex";
import { mapPool } from "../../shared/colonize/mapPool";
import { hasBuyStationWithinLy } from "../../shared/colonize/buyStationNearby";
import { IDLE_MATERIAL_BUY_SCAN_STATUS, type MaterialBuyScanQueueSlice } from "../../shared/colonize/materialBuyScanStatus";
import { patchMaterialBuyScanStatus } from "./materialBuyScanHub";
import { scanAndPersistMaterialHits } from "./spanshCheckout";
import { refreshMarketsById } from "./spanshStationMarket";

const SCAN_CONCURRENCY = 1;
const PASSIVE_DEBOUNCE_MS = 8000;
const ACTIVE_DEBOUNCE_MS = 1200;
const SCAN_GAP_MS = 450;

type ScanJob = {
  mode: "passive" | "active";
  index: MaterialBuyIndex;
  referenceSystem: string;
  items: BasketCheckoutItem[];
  force?: boolean;
  constructionDepots?: CheckoutFilters["constructionDepots"];
  /** Stop scanning a SKU once this many distinct seller systems are saved near the ref. */
  maxSystemsPerMaterial?: number | null;
  /** Markets the commander knows (journal): their whole market is read by id before any commodity search. */
  marketIds?: string[];
  /** Every material worth keeping from each answer's markets (default: `items`). */
  alsoFor?: BasketCheckoutItem[];
};

let passiveTimer: ReturnType<typeof setTimeout> | null = null;
let activeTimer: ReturnType<typeof setTimeout> | null = null;
let scanRunning = false;
const passiveQueue: ScanJob[] = [];
const activeQueue: ScanJob[] = [];

function queueKey(mode: "passive" | "active"): "passive" | "active" {
  return mode;
}

function syncQueueCounts(): void {
  patchMaterialBuyScanStatus({
    passive: { queuedJobs: passiveQueue.length },
    active: { queuedJobs: activeQueue.length },
    passivePaused: activeQueue.length > 0 || scanRunning,
  });
}

function patchQueue(mode: "passive" | "active", slice: Partial<MaterialBuyScanQueueSlice>): void {
  patchMaterialBuyScanStatus({ [queueKey(mode)]: slice });
}

function idleQueueSlice(): MaterialBuyScanQueueSlice {
  return { ...IDLE_MATERIAL_BUY_SCAN_STATUS.passive };
}

function jobKey(job: ScanJob): string {
  const ids = job.items
    .map((it) => itemCommodityId(it))
    .filter(Boolean)
    .sort()
    .join(",");
  return `${job.mode}\0${job.referenceSystem.trim().toLowerCase()}\0${ids}`;
}

async function runMaterialBuyScan(job: ScanJob): Promise<void> {
  await job.index.load();
  job.index.sanitizeSellHits();
  if (job.constructionDepots?.length) job.index.purgeConstructionDepotStations(job.constructionDepots);
  const ref = await resolveSpanshReferenceSystem(job.referenceSystem.trim());
  if (!ref || !job.items.length) return;

  const maxSystems = job.maxSystemsPerMaterial ?? null;
  const depots = job.constructionDepots ?? [];

  // The commander's own stations first: one request each gives everything they sell, with stock and price.
  if (job.marketIds?.length) {
    patchQueue(job.mode, { phase: "scanning", referenceSystem: ref, commodityLabel: "your markets", done: 0, total: job.marketIds.length });
    try {
      const found = await refreshMarketsById({
        index: job.index,
        referenceSystem: ref,
        marketIds: job.marketIds,
        items: job.items,
        constructionDepots: job.constructionDepots,
        onProgress: (done, total) => patchQueue(job.mode, { done, total }),
      });
      if (found > 0) patchMaterialBuyScanStatus({ lastStationsFound: found });
    } catch (e) {
      patchMaterialBuyScanStatus({ lastError: e instanceof Error ? e.message : String(e) });
    }
  }

  const stillNeeds = (it: BasketCheckoutItem): boolean => {
    const id = itemCommodityId(it);
    if (!id) return false;
    const label = itemCommodityLabel(it);
    const savedHits = job.index.getAllStationsForNeed(ref, id, label, {}, ref, depots);
    const hasNearby = hasBuyStationWithinLy(savedHits, undefined, {}, ref);
    if (hasNearby) {
      if (!job.force) return false;
      if (maxSystems != null && maxSystems > 0) {
        return job.index.needsMoreSystems(ref, id, label, maxSystems, depots);
      }
      return false;
    }
    if (maxSystems != null && maxSystems > 0) {
      if (!job.index.needsMoreSystems(ref, id, label, maxSystems, depots)) return false;
    }
    if (job.force) return true;
    return job.index.needsPassiveScan(ref, id, MATERIAL_BUY_CACHE_TTL_MS, maxSystems, label, depots);
  };
  // Biggest needs first: their answers carry whole markets, which often cover the smaller ones (checked again below).
  const todo = job.items.filter(stillNeeds).sort((a, b) => (b.quantityTons ?? 0) - (a.quantityTons ?? 0));

  if (!todo.length) {
    await job.index.flush();
    return;
  }

  patchQueue(job.mode, {
    phase: "scanning",
    referenceSystem: ref,
    commodityLabel: null,
    done: 0,
    total: todo.length,
  });
  syncQueueCounts();

  let done = 0;
  let lastItemError: string | null = null;
  await mapPool(todo, SCAN_CONCURRENCY, async (it) => {
    const label = itemCommodityLabel(it);
    patchQueue(job.mode, {
      phase: "scanning",
      referenceSystem: ref,
      commodityLabel: label,
      done,
      total: todo.length,
    });
    try {
      // An earlier answer's markets may have covered it by now: no request for it then.
      if (done > 0 && !stillNeeds(it)) {
        done += 1;
        patchQueue(job.mode, { done, total: todo.length });
        return;
      }
      if (done > 0) await new Promise((r) => setTimeout(r, SCAN_GAP_MS));
      const found = await scanAndPersistMaterialHits({
        index: job.index,
        referenceSystem: ref,
        item: it,
        constructionDepots: job.constructionDepots,
        alsoFor: job.alsoFor ?? job.items,
      });
      patchMaterialBuyScanStatus({
        lastStationsFound: typeof found === "number" && found > 0 ? found : null,
      });
    } catch (e) {
      lastItemError = e instanceof Error ? e.message : String(e);
      patchMaterialBuyScanStatus({ lastError: lastItemError });
    }
    done += 1;
    patchQueue(job.mode, { done, total: todo.length });
  });

  patchQueue(job.mode, { phase: "saving", commodityLabel: null, referenceSystem: ref });
  await job.index.flush();
}

/** Drop queued fleet/planner passive scans — e.g. when every depot material already has a seller. */
export function cancelPassiveMaterialBuyScan(): void {
  passiveQueue.length = 0;
  if (passiveTimer) {
    clearTimeout(passiveTimer);
    passiveTimer = null;
  }
  if (!scanRunning && !activeQueue.length) {
    patchMaterialBuyScanStatus({
      passive: idleQueueSlice(),
      passivePaused: false,
    });
  }
  syncQueueCounts();
}

export function schedulePassiveMaterialBuyScan(args: Omit<ScanJob, "mode">): void {
  /**
   * A running scan or a queued active job defers passive work, it does not cancel it — dropping
   * the request here meant anything asked for during a scan was simply never scanned. The drain
   * loop already runs active jobs first.
   */
  const job: ScanJob = { mode: "passive", ...args };
  if (!passiveQueue.some((j) => jobKey(j) === jobKey(job))) {
    passiveQueue.push(job);
    patchQueue("passive", { referenceSystem: args.referenceSystem.trim() });
  }
  syncQueueCounts();
  if (passiveTimer) clearTimeout(passiveTimer);
  passiveTimer = setTimeout(() => {
    passiveTimer = null;
    void drainScanQueues();
  }, PASSIVE_DEBOUNCE_MS);
}

export function scheduleActiveMaterialBuyScan(args: Omit<ScanJob, "mode">): void {
  passiveQueue.length = 0;
  if (passiveTimer) {
    clearTimeout(passiveTimer);
    passiveTimer = null;
  }
  const job: ScanJob = { mode: "active", ...args };
  if (!activeQueue.some((j) => jobKey(j) === jobKey(job))) {
    activeQueue.push(job);
    patchQueue("active", { referenceSystem: args.referenceSystem.trim() });
  }
  syncQueueCounts();
  if (activeTimer) clearTimeout(activeTimer);
  activeTimer = setTimeout(() => {
    activeTimer = null;
    void drainScanQueues();
  }, ACTIVE_DEBOUNCE_MS);
}

async function drainScanQueues(): Promise<void> {
  if (scanRunning) return;
  if (!activeQueue.length && !passiveQueue.length) return;

  scanRunning = true;
  syncQueueCounts();
  try {
    while (activeQueue.length || passiveQueue.length) {
      const mode: "passive" | "active" = activeQueue.length ? "active" : "passive";
      const job = mode === "active" ? activeQueue.shift()! : passiveQueue.shift()!;
      syncQueueCounts();
      try {
        await runMaterialBuyScan(job);
      } catch (e) {
        /** One failing job used to abort the loop and strand every job still queued behind it. */
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[edexo-colonize] material buy scan failed:", e);
        patchMaterialBuyScanStatus({ lastError: msg });
      }
    }
  } finally {
    scanRunning = false;
    if (!activeQueue.length && !passiveQueue.length) {
      patchMaterialBuyScanStatus({
        passive: idleQueueSlice(),
        active: idleQueueSlice(),
        passivePaused: false,
      });
    }
    syncQueueCounts();
  }
}
