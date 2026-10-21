import { commodityNeedMatchesLabel } from "./commodityKey";

export type ShopHistoryCachedOffer = {
  commodityId: string;
  label: string;
  supply: number;
  buyPrice: number | null;
};

export type ShopHistoryPurchase = {
  commodityId: string;
  label: string;
  count: number;
  buyPrice: number | null;
};

export type ShopHistoryEntry = {
  systemName: string;
  stationName: string;
  marketId: string;
  visitedAt: string;
  commodityIds: string[];
  /** Journal `MarketBuy` lines — ground truth that you purchased here. */
  purchases?: ShopHistoryPurchase[];
  /** Last Market.json snapshot when docked here — used when Spansh omits the station. */
  cachedOffers?: ShopHistoryCachedOffer[];
  /** Ly from construction system when last scanned. */
  constructionDistanceLy?: number | null;
  /** Rebuilt from journal `Market` / `MarketBuy` lines (ground truth). */
  fromJournal?: boolean;
};

const SHOP_HISTORY_KEY = "edexo-colonize-shop-history-v1";
const MAX_ENTRIES = 48;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function normStation(s: string): string {
  return norm(s).replace(/\s+/g, " ");
}

function stationsMatch(a: string, b: string): boolean {
  const x = normStation(a);
  const y = normStation(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function loadShopHistory(): ShopHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SHOP_HISTORY_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter(
      (e): e is ShopHistoryEntry =>
        Boolean(e && typeof e === "object") &&
        typeof (e as ShopHistoryEntry).stationName === "string" &&
        typeof (e as ShopHistoryEntry).systemName === "string",
    );
  } catch {
    return [];
  }
}

export function saveShopHistory(entries: ShopHistoryEntry[]): void {
  try {
    localStorage.setItem(SHOP_HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* */
  }
}

export function clearShopHistory(): void {
  saveShopHistory([]);
  try {
    localStorage.removeItem(SHOP_HISTORY_KEY);
  } catch {
    /* */
  }
}

export function recordShopVisit(
  args: {
    systemName: string;
    stationName: string;
    marketId: string;
    commodityIds?: string[];
    cachedOffers?: ShopHistoryCachedOffer[];
    constructionDistanceLy?: number | null;
  },
  prevHistory?: ShopHistoryEntry[],
): ShopHistoryEntry[] {
  const key = `${norm(args.systemName)}\0${normStation(args.stationName)}`;
  const now = new Date().toISOString();
  const loaded = prevHistory ?? loadShopHistory();
  const prev = loaded.filter((e) => `${norm(e.systemName)}\0${normStation(e.stationName)}` !== key);
  const mergedIds = new Set(args.commodityIds ?? []);
  const hit = loaded.find((e) => `${norm(e.systemName)}\0${normStation(e.stationName)}` === key);
  if (hit) for (const id of hit.commodityIds) mergedIds.add(id);

  const mergedOffers = new Map<string, ShopHistoryCachedOffer>();
  if (hit) for (const o of hit.cachedOffers ?? []) mergedOffers.set(o.commodityId, o);
  for (const o of args.cachedOffers ?? []) mergedOffers.set(o.commodityId, o);

  const entry: ShopHistoryEntry = {
    systemName: args.systemName.trim(),
    stationName: args.stationName.trim(),
    marketId: args.marketId,
    visitedAt: now,
    commodityIds: [...mergedIds],
    cachedOffers: mergedOffers.size ? [...mergedOffers.values()] : hit?.cachedOffers,
    constructionDistanceLy:
      args.constructionDistanceLy ?? hit?.constructionDistanceLy ?? null,
  };
  const next = [entry, ...prev].slice(0, MAX_ENTRIES);
  saveShopHistory(next);
  return next;
}

function systemsMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Fuzzy match — journal dock name vs Spansh station name (system + station, then station-only). */
export function findShopHistoryEntry(
  history: ShopHistoryEntry[],
  systemName: string,
  stationName: string,
): { entry: ShopHistoryEntry; index: number } | null {
  for (let i = 0; i < history.length; i++) {
    const e = history[i]!;
    if (!systemsMatch(e.systemName, systemName)) continue;
    if (stationsMatch(e.stationName, stationName)) return { entry: e, index: i };
  }
  for (let i = 0; i < history.length; i++) {
    const e = history[i]!;
    if (stationsMatch(e.stationName, stationName)) return { entry: e, index: i };
  }
  return null;
}

export function isRecentShopStation(
  history: ShopHistoryEntry[],
  systemName: string,
  stationName: string,
): boolean {
  return findShopHistoryEntry(history, systemName, stationName) != null;
}

export function hasBoughtFromStation(
  history: ShopHistoryEntry[],
  systemName: string,
  stationName: string,
): boolean {
  const hit = findShopHistoryEntry(history, systemName, stationName);
  if (!hit) return false;
  return hit.entry.commodityIds.length > 0 || (hit.entry.purchases?.length ?? 0) > 0;
}

export function shopEntryBoughtNeed(
  entry: ShopHistoryEntry,
  needId: string,
  needLabel: string,
): boolean {
  for (const id of entry.commodityIds) {
    if (id === needId || commodityNeedMatchesLabel(needId, needLabel, id)) return true;
  }
  for (const p of entry.purchases ?? []) {
    if (p.count <= 0) continue;
    if (p.commodityId === needId || commodityNeedMatchesLabel(needId, needLabel, p.commodityId)) return true;
  }
  return false;
}
