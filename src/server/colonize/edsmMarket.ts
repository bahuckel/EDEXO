import { lyOrLast, nearerLy, type Ly } from "../../shared/colonize/systemDistanceLy";
import { parseMarketId } from "../../shared/colonize/marketId";
import { TtlCache } from "../../shared/colonize/ttlCache";
import { commodityCatalogNormKeys, commodityMergeBucket, commodityNormKey } from "../../shared/colonize/commodityKey";
import type { CheckoutFilters } from "../../shared/colonize/types";
import { isSurfaceStationLabel, isSurfaceStationType } from "../../shared/colonize/stationFilter";
import { fetchEdsmJson } from "./galaxySystemCoords";
import { isTransientFetchError } from "./httpGate";

const EDSM_MARKET = "https://www.edsm.net/api-system-v1/stations/market";
const EDSM_STATIONS = "https://www.edsm.net/api-system-v1/stations";
const EDSM_SPHERE = "https://www.edsm.net/api-v1/sphere-systems";

const MARKET_CACHE_TTL_MS = 30 * 60 * 1000;
const MARKET_CACHE_MAX = 800;
/**
 * PERF-M9. The per-system station list had no cap and no expiry: a long session sweeping
 * spheres kept every system it ever listed, and a station built since launch never appeared.
 */
const SYSTEM_STATIONS_TTL_MS = 24 * 60 * 60 * 1000;
const SYSTEM_STATIONS_MAX = 800;
/**
 * Expand until every basket line has a seller or this Ly cap is reached. EDSM's `sphere-systems`
 * endpoint rejects anything above 100 Ly, so the old 150–2000 Ly steps each burned a rate-gated
 * call and came back with nothing.
 */
const RADIUS_STEPS_LY = [30, 60, 100];
const MAX_MARKET_FETCHES = 2500;
/**
 * Station lists are one rate-gated call per system, and a 100 Ly sphere is thousands of systems.
 * Budget them like market fetches so a search cannot run for hours.
 */
const MAX_STATION_FETCHES = 400;

export type NeedRow = { id: string; label: string; quantityTons: number };

type EdsmCommodityRow = {
  id: string;
  name: string;
  buyPrice: number;
  stock: number;
};

export type EdsmStationMarketHit = {
  systemName: string;
  stationName: string;
  marketId: string;
  distanceLy: Ly;
  stationType: string | null;
  isPlanetaryOrGround: boolean;
  marketUpdatedAt: string | null;
  offers: Map<string, { edsmCommodity: string; buyPrice: number; stock: number }>;
};

export type EdsmExhaustiveSearchResult = {
  hits: EdsmStationMarketHit[];
  stillMissing: NeedRow[];
  maxRadiusLy: number;
  marketsScanned: number;
};

/** `null` = EDSM answered and there is no market; a throttle is never cached. */
const marketCache = new TtlCache<string, EdsmCommodityRow[] | null>({
  max: MARKET_CACHE_MAX,
  ttlMs: MARKET_CACHE_TTL_MS,
});
const systemStationsCache = new TtlCache<string, StationRef[]>({
  max: SYSTEM_STATIONS_MAX,
  ttlMs: SYSTEM_STATIONS_TTL_MS,
});

function needBucket(need: NeedRow): string {
  return need.id || commodityMergeBucket(need.label) || commodityNormKey(need.label);
}

function edsmRowMatchesNeed(need: NeedRow, row: { id: string; name: string }): boolean {
  const keys = commodityCatalogNormKeys(need.id, need.label);
  if (keys.has(row.id)) return true;
  const rowNk = commodityNormKey(row.id);
  for (const k of keys) {
    if (k === row.id || commodityNormKey(k) === rowNk) return true;
  }
  const nameNk = commodityNormKey(row.name);
  for (const k of keys) {
    if (commodityNormKey(k) === nameNk) return true;
  }
  return false;
}

function parseMarketPayload(payload: unknown): EdsmCommodityRow[] | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const commodities = rec.commodities;
  if (!Array.isArray(commodities)) return null;
  const out: EdsmCommodityRow[] = [];
  for (const row of commodities) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : "";
    const name = typeof r.name === "string" ? r.name : id;
    const stock = typeof r.stock === "number" ? r.stock : 0;
    if (!id || stock <= 0) continue;
    const sellPrice =
      typeof r.sellPrice === "number"
        ? r.sellPrice
        : typeof r.sell_price === "number"
          ? r.sell_price
          : typeof r.buyPrice === "number"
            ? r.buyPrice
            : 0;
    out.push({ id, name, buyPrice: sellPrice, stock });
  }
  return out;
}

async function fetchStationMarket(marketId: string): Promise<EdsmCommodityRow[] | null> {
  const key = marketId.trim();
  if (!key) return null;
  const cached = marketCache.get(key);
  if (cached !== undefined) return cached;

  let payload: unknown;
  try {
    payload = await fetchEdsmJson(`${EDSM_MARKET}?marketId=${encodeURIComponent(key)}`);
  } catch (e) {
    /** A throttle or an outage is "not now", not "no market": caching it hid the station for 30 min. */
    if (!isTransientFetchError(e)) marketCache.set(key, null);
    return null;
  }
  const parsed = parseMarketPayload(payload);
  marketCache.set(key, parsed);
  return parsed;
}

type StationRef = {
  systemName: string;
  stationName: string;
  marketId: string;
  distanceLy: Ly;
  stationType: string | null;
};

function stationPlanetary(type: string | null, name: string): boolean {
  return isSurfaceStationType(type, false, name) || isSurfaceStationLabel(name);
}

/** Search-only filters: no Ly cap, any stock, all station types (except explicit user bans). */
function passesSearchStationFilters(_st: StationRef, _filters: CheckoutFilters): boolean {
  return true;
}

/** Cached system station lists are free — only uncached ones spend the station-fetch budget. */
function systemStationsCached(systemName: string): boolean {
  return systemStationsCache.has(systemName.trim().toLowerCase());
}

async function fetchSystemStations(systemName: string): Promise<StationRef[]> {
  const sys = systemName.trim();
  if (!sys) return [];
  const cached = systemStationsCache.get(sys.toLowerCase());
  if (cached) return cached;

  let payload: unknown;
  try {
    payload = await fetchEdsmJson(`${EDSM_STATIONS}?systemName=${encodeURIComponent(sys)}`);
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object") return [];
  const rec = payload as Record<string, unknown>;
  const sysName = typeof rec.name === "string" ? rec.name : sys;
  const stations = rec.stations;
  if (!Array.isArray(stations)) return [];
  const out: StationRef[] = [];
  for (const row of stations) {
    if (!row || typeof row !== "object") continue;
    const s = row as Record<string, unknown>;
    if (s.haveMarket !== true) continue;
    const name = typeof s.name === "string" ? s.name : "";
    const marketId = parseMarketId(s.marketId) ?? "";
    if (!name || !marketId) continue;
    const stType = typeof s.type === "string" ? s.type : null;
    out.push({
      systemName: sysName,
      stationName: name,
      marketId,
      /** Filled in from the sphere search that found the system; unknown until then. */
      distanceLy: null,
      stationType: stType,
    });
  }
  systemStationsCache.set(sys.toLowerCase(), out);
  return out;
}

async function fetchSphereSystems(referenceSystem: string, radiusLy: number): Promise<{ name: string; distanceLy: number }[]> {
  const ref = referenceSystem.trim();
  if (!ref) return [];
  let payload: unknown;
  try {
    payload = await fetchEdsmJson(
      `${EDSM_SPHERE}?systemName=${encodeURIComponent(ref)}&radius=${encodeURIComponent(String(radiusLy))}`,
    );
  } catch {
    return [];
  }
  if (!Array.isArray(payload)) return [];
  const out: { name: string; distanceLy: number }[] = [];
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    const dist = typeof r.distance === "number" ? r.distance : Number.POSITIVE_INFINITY;
    if (!name || !Number.isFinite(dist)) continue;
    out.push({ name, distanceLy: dist });
  }
  out.sort((a, b) => a.distanceLy - b.distanceLy);
  return out;
}

type BestOffer = {
  bucket: string;
  need: NeedRow;
  station: StationRef;
  offer: { edsmCommodity: string; buyPrice: number; stock: number };
  distanceLy: Ly;
};

function hitsFromBestOffers(best: Map<string, BestOffer>): EdsmStationMarketHit[] {
  const byMarket = new Map<string, EdsmStationMarketHit>();
  for (const row of best.values()) {
    const st = row.station;
    let hit = byMarket.get(st.marketId);
    if (!hit) {
      hit = {
        systemName: st.systemName,
        stationName: st.stationName,
        marketId: st.marketId,
        distanceLy: row.distanceLy,
        stationType: st.stationType,
        isPlanetaryOrGround: stationPlanetary(st.stationType, st.stationName),
        marketUpdatedAt: null,
        offers: new Map(),
      };
      byMarket.set(st.marketId, hit);
    } else {
      hit.distanceLy = nearerLy(hit.distanceLy, row.distanceLy);
    }
    hit.offers.set(row.bucket, row.offer);
  }
  return [...byMarket.values()].sort(
    (a, b) => lyOrLast(a.distanceLy) - lyOrLast(b.distanceLy) || a.stationName.localeCompare(b.stationName),
  );
}

/**
 * Nearest seller per commodity — expands the EDSM sphere until every need is found or the 100 Ly
 * endpoint limit is reached. Ignores market age; any stock &gt; 0 counts.
 */
export async function exhaustiveEdsmBuySearch(args: {
  referenceSystem: string;
  needs: NeedRow[];
  filters: CheckoutFilters;
  /** Cap market API calls (interactive checkout uses a lower budget). */
  maxMarketFetches?: number;
  /** Cap per-system station-list calls; they are rate-gated the same way market calls are. */
  maxStationFetches?: number;
}): Promise<EdsmExhaustiveSearchResult> {
  const ref = args.referenceSystem.trim();
  const needs = args.needs
    .map((n) => ({
      id: n.id || commodityMergeBucket(n.label) || commodityNormKey(n.label),
      label: n.label,
      quantityTons: n.quantityTons,
    }))
    .filter((n) => n.id && n.label);
  if (!ref || !needs.length) {
    return { hits: [], stillMissing: needs, maxRadiusLy: 0, marketsScanned: 0 };
  }

  const itemRows = needs.map((need) => ({ need, bucket: needBucket(need) }));
  const best = new Map<string, BestOffer>();
  const stationMap = new Map<string, StationRef>();
  const scannedMarkets = new Set<string>();
  let marketsScanned = 0;
  let maxRadiusLy = 0;
  const fetchBudget = Math.max(1, Math.min(args.maxMarketFetches ?? MAX_MARKET_FETCHES, MAX_MARKET_FETCHES));
  const stationFetchBudget = Math.max(
    1,
    Math.min(args.maxStationFetches ?? MAX_STATION_FETCHES, MAX_STATION_FETCHES),
  );
  let stationFetches = 0;

  const stationsForSystem = async (systemName: string): Promise<StationRef[]> => {
    if (!systemStationsCached(systemName)) {
      if (stationFetches >= stationFetchBudget) return [];
      stationFetches++;
    }
    return fetchSystemStations(systemName);
  };

  const addStation = (st: StationRef): void => {
    if (!st.marketId || !st.stationName || !st.systemName) return;
    const key = st.marketId;
    const prev = stationMap.get(key);
    if (!prev || lyOrLast(st.distanceLy) < lyOrLast(prev.distanceLy)) stationMap.set(key, st);
  };

  for (const snap of args.filters.shopMarketSnapshots ?? []) {
    if (!snap.marketId) continue;
    addStation({
      systemName: snap.systemName,
      stationName: snap.stationName,
      marketId: snap.marketId,
      distanceLy:
        snap.constructionDistanceLy != null && Number.isFinite(snap.constructionDistanceLy)
          ? snap.constructionDistanceLy
          : 0,
      stationType: null,
    });
  }

  for (const st of await stationsForSystem(ref)) {
    addStation({ ...st, distanceLy: 0 });
  }

  const stillMissing = (): NeedRow[] =>
    itemRows.filter(({ bucket }) => !best.has(bucket)).map(({ need }) => need);

  for (const radiusLy of RADIUS_STEPS_LY) {
    if (stillMissing().length === 0) break;
    maxRadiusLy = radiusLy;

    const sphere = await fetchSphereSystems(ref, radiusLy);
    for (const sys of sphere) {
      if (sys.name.trim().toLowerCase() === ref.toLowerCase()) continue;
      for (const st of await stationsForSystem(sys.name)) {
        addStation({ ...st, distanceLy: sys.distanceLy });
      }
    }

    const sortedStations = [...stationMap.values()].sort((a, b) => lyOrLast(a.distanceLy) - lyOrLast(b.distanceLy));

    for (const st of sortedStations) {
      if (stillMissing().length === 0) break;
      if (!passesSearchStationFilters(st, args.filters)) continue;
      if (scannedMarkets.has(st.marketId)) continue;
      if (marketsScanned >= fetchBudget) break;

      scannedMarkets.add(st.marketId);
      marketsScanned++;

      const market = await fetchStationMarket(st.marketId);
      if (!market?.length) continue;

      for (const { need, bucket } of itemRows) {
        if (best.has(bucket)) continue;
        let pick: { edsmCommodity: string; buyPrice: number; stock: number } | null = null;
        for (const row of market) {
          if (!edsmRowMatchesNeed(need, row)) continue;
          if (!pick || row.stock > pick.stock) {
            pick = { edsmCommodity: row.id || row.name, buyPrice: row.buyPrice, stock: row.stock };
          }
        }
        if (!pick) continue;
        best.set(bucket, {
          bucket,
          need,
          station: st,
          offer: pick,
          distanceLy: st.distanceLy,
        });
      }
    }
  }

  return {
    hits: hitsFromBestOffers(best),
    stillMissing: stillMissing(),
    maxRadiusLy,
    marketsScanned,
  };
}
