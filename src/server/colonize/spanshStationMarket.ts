/**
 * Stations' whole markets by market id (owner, 2026-10-23: "use the full potential of the market ids"). Spansh's
 * station search takes a list of market ids and answers each station with every commodity it trades (supply, price,
 * the market's own timestamp), so one request fills in every material many known stations sell, not just the one each
 * was found for (`/api/station/<id>` answers one station per request).
 *
 * Used for the stations in the commander's journal: a station he bought Titanium at was known to sell Titanium, with no
 * stock or price unless Market.json had been open there; its Steel and Liquid Oxygen were not known at all.
 */
import { TtlCache } from "../../shared/colonize/ttlCache";
import { parseMarketId } from "../../shared/colonize/marketId";
import { basketItemId, itemLabel } from "../../shared/colonize/commodityKey";
import type { BasketCheckoutItem, CheckoutFilters } from "../../shared/colonize/types";
import { filterHitsForBuyIndex, hitsFromBuyPayload } from "./checkoutIndexBridge";
import { rememberSystemFromSpansh } from "./galaxySystemCoords";
import { fetchJson, spanshGate } from "./httpGate";
import type { MaterialBuyIndex } from "./materialBuyIndex";
import type { SpanshBuyPayload } from "./checkoutStationMap";
import type { SpanshStationSearchRow } from "./spanshStationBuySearch";

const STATIONS_SEARCH = "https://spansh.co.uk/api/stations/search";
/** Market ids per search request (each answer carries whole markets, ~100 KB a station). */
const IDS_PER_SEARCH = 50;
const FETCH_TIMEOUT_MS = 18_000;
/** A market asked for within this long is not asked for again (Spansh updates from EDDN as commanders dock). */
const MARKET_TTL_MS = 6 * 60 * 60 * 1000;
/** Per run: enough for every station a commander bought construction goods at, without a burst of requests. */
export const MARKETS_PER_RUN = 40;

/** Market id → when it was asked (null answers too: Spansh does not know that station). */
const asked = new TtlCache<string, true>({ max: 2_000, ttlMs: MARKET_TTL_MS });

/**
 * Many stations in one request: Spansh's station search takes a list of market ids (checked 2026-10-23: three ids, one
 * answer, three whole markets). Returns the rows by market id; ids Spansh does not know are simply absent. Was one
 * GET per station (R2, 2026-10-23: "fetch once, in bulk").
 */
export async function fetchSpanshStationsByMarketIds(marketIds: string[]): Promise<Map<string, SpanshStationSearchRow>> {
  const ids = [...new Set(marketIds.map((m) => parseMarketId(m)).filter((m): m is string => !!m))];
  const out = new Map<string, SpanshStationSearchRow>();
  for (let i = 0; i < ids.length; i += IDS_PER_SEARCH) {
    const chunk = ids.slice(i, i + IDS_PER_SEARCH);
    const body = (await fetchJson(spanshGate, STATIONS_SEARCH, {
      timeoutMs: FETCH_TIMEOUT_MS,
      body: { filters: { market_id: { value: chunk } }, size: chunk.length },
    })) as { results?: SpanshStationSearchRow[] };
    for (const row of Array.isArray(body?.results) ? body.results : []) {
      const mid = parseMarketId(row.market_id);
      if (!mid || !row.name) continue;
      if (typeof row.system_name === "string") rememberSystemFromSpansh(row.system_name, [row.system_x, row.system_y, row.system_z]);
      out.set(mid, row);
    }
  }
  return out;
}

/**
 * Ask Spansh for the whole market of each station (not asked within MARKET_TTL_MS, at most MARKETS_PER_RUN) and save
 * every commodity in `items` that it sells, with supply and price, under `referenceSystem`. Returns the hits saved.
 */
export async function refreshMarketsById(args: {
  index: MaterialBuyIndex;
  referenceSystem: string;
  marketIds: string[];
  items: BasketCheckoutItem[];
  constructionDepots?: CheckoutFilters["constructionDepots"];
  onProgress?: (done: number, total: number) => void;
}): Promise<number> {
  const needs = args.items
    .map((it) => ({ id: basketItemId(it), label: itemLabel(it) }))
    .filter((n) => n.id);
  if (!needs.length) return 0;
  const todo = [...new Set(args.marketIds.map((m) => parseMarketId(m)).filter((m): m is string => !!m))]
    .filter((m) => !asked.has(m))
    .slice(0, MARKETS_PER_RUN);
  let saved = 0;
  let done = 0;
  for (const mid of todo) asked.set(mid, true);
  let rows = new Map<string, SpanshStationSearchRow>();
  try {
    rows = await fetchSpanshStationsByMarketIds(todo);
  } catch {
    for (const mid of todo) asked.delete(mid); // an outage or throttle: ask again next time
  }
  for (const mid of todo) {
    const row = rows.get(mid) ?? null;
    if (row) {
      const payload = { results: [row] } as SpanshBuyPayload;
      for (const need of needs) {
        const hits = filterHitsForBuyIndex(
          hitsFromBuyPayload(args.referenceSystem, need, payload, "spansh", need.label),
          args.constructionDepots,
        );
        if (hits.length) {
          args.index.mergeStations(args.referenceSystem, need.id, need.label, hits);
          saved += hits.length;
        }
      }
    }
    done += 1;
    args.onProgress?.(done, todo.length);
  }
  return saved;
}

/** Tests only. */
export function resetMarketsAskedForTests(): void {
  asked.clear();
}
