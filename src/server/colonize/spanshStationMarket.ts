/**
 * A station's whole market by its market id (owner, 2026-10-23: "use the full potential of the market ids"). Spansh
 * answers `GET /api/station/<marketId>` with the station and every commodity it trades (supply, price, the market's
 * own timestamp), so one request fills in every material a known station sells, not just the one it was found for.
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
import { fetchJson, HttpStatusError, spanshGate } from "./httpGate";
import type { MaterialBuyIndex } from "./materialBuyIndex";
import type { SpanshBuyPayload } from "./checkoutStationMap";
import type { SpanshStationSearchRow } from "./spanshStationBuySearch";

const STATION_URL = "https://spansh.co.uk/api/station/";
const FETCH_TIMEOUT_MS = 18_000;
/** A market asked for within this long is not asked for again (Spansh updates from EDDN as commanders dock). */
const MARKET_TTL_MS = 6 * 60 * 60 * 1000;
/** Per run: enough for every station a commander bought construction goods at, without a burst of requests. */
export const MARKETS_PER_RUN = 40;

/** Market id → when it was asked (null answers too: Spansh does not know that station). */
const asked = new TtlCache<string, true>({ max: 2_000, ttlMs: MARKET_TTL_MS });

export async function fetchSpanshStationMarket(marketId: string): Promise<SpanshStationSearchRow | null> {
  const mid = parseMarketId(marketId);
  if (!mid) return null;
  try {
    const body = (await fetchJson(spanshGate, `${STATION_URL}${encodeURIComponent(mid)}`, { timeoutMs: FETCH_TIMEOUT_MS })) as {
      record?: SpanshStationSearchRow;
    } & SpanshStationSearchRow;
    const row = (body && typeof body === "object" && body.record ? body.record : body) as SpanshStationSearchRow | null;
    if (!row || typeof row !== "object" || !row.name) return null;
    if (typeof row.system_name === "string") rememberSystemFromSpansh(row.system_name, [row.system_x, row.system_y, row.system_z]);
    return { ...row, market_id: row.market_id ?? mid };
  } catch (e) {
    if (e instanceof HttpStatusError && (e.status === 400 || e.status === 404)) return null;
    throw e;
  }
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
  for (const mid of todo) {
    asked.set(mid, true);
    let row: SpanshStationSearchRow | null = null;
    try {
      row = await fetchSpanshStationMarket(mid);
    } catch {
      asked.delete(mid); // an outage or throttle: ask again next time
    }
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
