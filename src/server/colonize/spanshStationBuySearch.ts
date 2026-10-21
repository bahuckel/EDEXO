import { parseMarketId } from "../../shared/colonize/marketId";
import { TtlCache } from "../../shared/colonize/ttlCache";
import { commodityLabelsEquivalent } from "../../shared/colonize/commodityKey";
import { marketRowsForPlayerBuy, parseMarketRowForPlayerBuy } from "../../shared/colonize/stationSellOffer";
import { isFdevSymbolSlug, spanshLabelKey } from "../../shared/colonize/spanshCommodity";
import type { SpanshStationSearchCommodityFilter } from "../../shared/colonize/spanshCommodity";
import { resolveSpanshReferenceSystem } from "./galaxySystemCoords";
import { fetchJson, HttpStatusError, spanshGate } from "./httpGate";

const SPANSH_SEARCH = "https://spansh.co.uk/api/stations/search";
const FETCH_TIMEOUT_MS = 18_000;
/** Spansh caps a page at 120 rows. */
const SEARCH_PAGE_SIZE = 120;
/**
 * Two pages reach past the settlement cluster around a colonised system without turning one
 * lookup into a burst of requests. Around the test system that is roughly 0-120 Ly.
 */
const SEARCH_DEFAULT_PAGES = 2;
const SEARCH_MAX_PAGES = 5;
const RECALL_MIN_STATIONS_TO_CACHE = 3;
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 200;

export type SpanshStationSearchRow = {
  name?: string;
  system_name?: string;
  market_id?: string | number;
  id?: string | number;
  distance?: number;
  market?: Array<{ commodity?: string; supply?: number; buy_price?: number }>;
  is_planetary?: boolean;
  type?: string;
  body_name?: string;
  updated_at?: string;
  market_updated_at?: string;
};

export type SpanshStationSearchPayload = {
  count?: number;
  results?: SpanshStationSearchRow[];
};

/** `null` = Spansh rejected the query (400/404): it will not have sellers for it next time either. */
const searchCache = new TtlCache<string, SpanshStationSearchPayload | null>({
  max: SEARCH_CACHE_MAX,
  ttlMs: SEARCH_CACHE_TTL_MS,
});

function searchCacheKey(referenceSystem: string, field: string, commodityName: string): string {
  return `${referenceSystem.trim().toLowerCase()}\0${field}\0${commodityName.trim().toLowerCase()}`;
}

/** Market id when Spansh supplies one, else the physical place. */
function stationSearchRowKey(row: SpanshStationSearchRow): string {
  const mid = parseMarketId(row.market_id ?? row.id);
  if (mid) return `m:${mid}`;
  return `s:${String(row.system_name ?? "").trim().toLowerCase()}\u0000${String(row.name ?? "").trim().toLowerCase()}`;
}

/** Spansh station search uses `name` / `symbol`; only rows with supply/stock for sale. */
export function normalizeSpanshMarketArray(
  market: unknown,
): Array<{ commodity?: string; supply?: number; buy_price?: number }> {
  if (!Array.isArray(market)) return [];
  const out: Array<{ commodity?: string; supply?: number; buy_price?: number }> = [];
  for (const raw of market) {
    const parsed = parseMarketRowForPlayerBuy(raw);
    if (!parsed) continue;
    out.push({
      commodity: parsed.commodity,
      supply: parsed.supply,
      buy_price: parsed.playerBuyPrice ?? undefined,
    });
  }
  return out;
}

function stationSearchRowToLegacy(row: SpanshStationSearchRow): {
  name?: string;
  system_name?: string;
  market_id?: string | number;
  distance?: number;
  market?: Array<{ commodity?: string; supply?: number; buy_price?: number }>;
  is_planetary?: boolean;
  type?: string;
  body_name?: string;
  market_updated_at?: string;
} {
  const mid = row.market_id ?? row.id;
  return {
    name: row.name,
    system_name: row.system_name,
    market_id: mid,
    distance: row.distance,
    market: normalizeSpanshMarketArray(row.market),
    is_planetary: row.is_planetary,
    type: row.type,
    body_name: row.body_name,
    market_updated_at: row.market_updated_at ?? row.updated_at,
  };
}

/** Commodity label Spansh station search accepts in `filters.market[].name` (FDev display name). */
export function pickSpanshCommodityFromSearchResults(
  payload: SpanshStationSearchPayload,
  filterName: string,
): string | null {
  const want = spanshLabelKey(filterName);
  const results = Array.isArray(payload.results) ? payload.results : [];
  for (const st of results) {
    const market = Array.isArray(st.market) ? st.market : [];
    for (const row of marketRowsForPlayerBuy(market)) {
      if (spanshLabelKey(row.commodity) === want || commodityLabelsEquivalent(row.commodity, filterName)) {
        return row.commodity;
      }
    }
  }
  return filterName.trim() || null;
}

/**
 * Spansh station search for one commodity, nearest first.
 *
 * This posts the search directly rather than going through `search/save` + polling `recall`.
 * Two reasons, both measured against the live API:
 *
 *   - `save`/`recall` ignores the `page` field. Asking for page 0 and page 1 returns byte
 *     identical rows, so that route could never see past the first 120 stations however many
 *     times it was called. Around a colonised system those 120 are mostly nearby settlements,
 *     which is how a commodity with plenty of large-pad sellers further out came back empty.
 *   - The direct post answers in one request with no polling loop, and reports the true total.
 *
 * Pages are merged and de-duplicated by market id, then station identity.
 */
export async function searchSpanshBuyStations(args: {
  referenceSystem: string;
  commodityFilterName: string;
  /** Spansh filter field — auto-detects symbol slugs when omitted. */
  commodityFilterField?: SpanshStationSearchCommodityFilter["field"];
  skipCache?: boolean;
  /** Pages of `SEARCH_PAGE_SIZE` to merge. More reach costs one request each. */
  pages?: number;
}): Promise<SpanshStationSearchPayload | null> {
  const refRaw = args.referenceSystem.trim();
  const commodity = args.commodityFilterName.trim();
  if (!refRaw || !commodity) return null;
  const ref = await resolveSpanshReferenceSystem(refRaw);

  const field = args.commodityFilterField ?? (isFdevSymbolSlug(commodity) ? "symbol" : "name");

  const ckey = searchCacheKey(ref, field, commodity);
  if (!args.skipCache) {
    const hit = searchCache.get(ckey);
    if (hit !== undefined) return hit;
  }

  const wantPages = Math.max(1, Math.min(args.pages ?? SEARCH_DEFAULT_PAGES, SEARCH_MAX_PAGES));
  const merged = new Map<string, SpanshStationSearchRow>();
  let total = 0;
  let sawAnyResponse = false;

  for (let page = 0; page < wantPages; page++) {
    const body = {
      filters: {
        has_market: { value: true },
        market: [
          {
            [field]: commodity,
            supply: { value: ["1", String(Number.MAX_SAFE_INTEGER)], comparison: "<=>" },
          },
        ],
      },
      sort: [{ distance: { direction: "asc" } }],
      size: SEARCH_PAGE_SIZE,
      page,
      reference_system: ref,
    };

    let data: SpanshStationSearchPayload;
    try {
      data = (await fetchJson(spanshGate, SPANSH_SEARCH, {
        timeoutMs: FETCH_TIMEOUT_MS,
        body,
      })) as SpanshStationSearchPayload;
    } catch (e) {
      /**
       * Only a genuine client error means "Spansh has nothing for this commodity". Caching a
       * throttle or an outage made one 429 or 5xx mark the commodity unavailable for the whole
       * 10-minute TTL, so every later lookup in the session skipped it. The gate has already
       * waited out and retried a throttle by the time a 429 reaches here.
       */
      if (e instanceof HttpStatusError && (e.status === 400 || e.status === 404)) {
        searchCache.set(ckey, null);
        return null;
      }
      break;
    }

    sawAnyResponse = true;
    const rows = Array.isArray(data.results) ? data.results : [];
    if (typeof data.count === "number" && data.count > total) total = data.count;
    for (const row of rows) {
      merged.set(stationSearchRowKey(row), row);
    }
    /** A short page is the last one; asking for the next would repeat it. */
    if (rows.length < SEARCH_PAGE_SIZE) break;
  }

  if (!sawAnyResponse) return null;

  const payload: SpanshStationSearchPayload = {
    count: total > 0 ? total : merged.size,
    results: [...merged.values()].map(stationSearchRowToLegacy),
  };
  if (payload.results!.length >= RECALL_MIN_STATIONS_TO_CACHE) {
    searchCache.set(ckey, payload);
  }
  return payload;
}

export function spanshSearchToBuyPayload(search: SpanshStationSearchPayload): {
  count?: number;
  results?: Array<{
    name?: string;
    system_name?: string;
    market_id?: string | number;
    distance?: number;
    market?: Array<{ commodity?: string; supply?: number; buy_price?: number }>;
    is_planetary?: boolean;
    type?: string;
    body_name?: string;
    market_updated_at?: string;
  }>;
} {
  return {
    count: search.count,
    results: search.results,
  };
}
