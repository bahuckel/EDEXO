import { parseMarketId } from "../../shared/colonize/marketId";
import { mapPool } from "../../shared/colonize/mapPool";
import { normSystemName } from "../../shared/colonize/stationFilter";

import type {
  SpanshDebugCommodityHit,
  SpanshRawHttpCapture,
  SpanshSystemDebugResult,
} from "../../shared/colonize/spanshSystemDebugTypes";

import { resolveSpanshReferenceSystem } from "./galaxySystemCoords";
import { JSON_HEADERS, spanshGate } from "./httpGate";

const SPANSH_BASE = "https://spansh.co.uk/api";

const FETCH_TIMEOUT_MS = 30_000;

const STATION_CONCURRENCY = 4;

const MAX_ALL_STATION_MARKETS = 12;

const MAX_FILTERED_STATION_MARKETS = 8;


type TypeaheadRow = { id64?: number | string; name?: string };

type DumpCommodity = {
  name?: string;

  commodity?: string;

  symbol?: string;

  supply?: number;

  buyPrice?: number;

  sellPrice?: number;

  demand?: number;
};

async function spanshFetch(url: string, init?: RequestInit): Promise<{ res: Response; text: string }> {
  const res = await spanshGate.fetch(
    url,
    {
      ...init,

      headers: { ...JSON_HEADERS, ...(init?.headers as Record<string, string> | undefined) },
    },
    { timeoutMs: FETCH_TIMEOUT_MS },
  );

  const text = await res.text();

  return { res, text };
}

function parseJsonBody(text: string): unknown {
  const t = text.trim();

  if (!t) return null;

  try {
    return JSON.parse(t) as unknown;
  } catch {
    return { _parseError: true, _rawText: text.slice(0, 8000) };
  }
}

async function capture(
  captures: SpanshRawHttpCapture[],

  url: string,

  method: string,

  init?: RequestInit,
): Promise<unknown> {
  const t0 = Date.now();

  try {
    const { res, text } = await spanshFetch(url, init);

    const body = parseJsonBody(text);

    captures.push({
      url,

      method,

      status: res.status,

      ok: res.ok,

      durationMs: Date.now() - t0,

      body,
    });

    return body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);

    captures.push({
      url,

      method,

      status: 0,

      ok: false,

      durationMs: Date.now() - t0,

      body: null,

      error: msg,
    });

    return null;
  }
}

function id64FromTypeahead(body: unknown, norm: string): { id64: string; name: string } | null {
  if (!body || typeof body !== "object") return null;

  const rec = body as { min_max?: unknown; values?: unknown };

  const minMax = Array.isArray(rec.min_max) ? rec.min_max : [];

  for (const row of minMax) {
    if (!row || typeof row !== "object") continue;

    const r = row as TypeaheadRow;

    const name = typeof r.name === "string" ? r.name.trim() : "";

    const id = r.id64;

    const id64 = typeof id === "number" ? String(id) : typeof id === "string" ? id.trim() : "";

    if (name && id64 && normSystemName(name) === norm) return { id64, name };
  }

  const values = Array.isArray(rec.values) ? rec.values : [];

  for (const v of values) {
    const name = typeof v === "string" ? v.trim() : "";

    if (name && normSystemName(name) === norm) {
      const hit = minMax.find(
        (row) =>
          row && typeof row === "object" && normSystemName(String((row as TypeaheadRow).name ?? "")) === norm,
      ) as TypeaheadRow | undefined;

      const id = hit?.id64;

      const id64 = typeof id === "number" ? String(id) : typeof id === "string" ? id.trim() : "";

      if (id64) return { id64, name };
    }
  }

  return null;
}

function extractCommoditySummary(dumpBody: unknown): {
  hits: SpanshDebugCommodityHit[];
  stationsWithMarkets: number;
} {
  const hits: SpanshDebugCommodityHit[] = [];

  let stationsWithMarkets = 0;

  if (!dumpBody || typeof dumpBody !== "object") return { hits, stationsWithMarkets };

  const stations = (dumpBody as { system?: { stations?: unknown } }).system?.stations;

  if (!Array.isArray(stations)) return { hits, stationsWithMarkets };

  for (const st of stations) {
    if (!st || typeof st !== "object") continue;

    const s = st as Record<string, unknown>;

    const stationName = typeof s.name === "string" ? s.name : "Unknown";

    const market = s.market;

    if (!market || typeof market !== "object") continue;

    const commodities = (market as { commodities?: unknown }).commodities;

    if (!Array.isArray(commodities) || commodities.length === 0) continue;

    stationsWithMarkets += 1;

    for (const c of commodities) {
      if (!c || typeof c !== "object") continue;

      const row = c as DumpCommodity;

      const commodity =
        typeof row.name === "string" ? row.name : typeof row.commodity === "string" ? row.commodity : "";

      if (!commodity) continue;

      const supply = typeof row.supply === "number" ? row.supply : undefined;

      const buyPrice = typeof row.buyPrice === "number" ? row.buyPrice : undefined;

      if ((supply ?? 0) <= 0) continue;

      const symbol = typeof row.symbol === "string" ? row.symbol : undefined;

      hits.push({
        stationName,

        commodity,

        symbol,

        supply,

        buyPrice,

        sellPrice: typeof row.sellPrice === "number" ? row.sellPrice : undefined,

        demand: typeof row.demand === "number" ? row.demand : undefined,
      });
    }
  }

  hits.sort((a, b) => a.commodity.localeCompare(b.commodity) || a.stationName.localeCompare(b.stationName));

  return { hits, stationsWithMarkets };
}

function collectStationMarketIds(
  systemBody: unknown,

  stationNameFilter: string,

  includeAll: boolean,
): { marketId: string; stationName: string }[] {
  if (!systemBody || typeof systemBody !== "object") return [];

  const stations = (systemBody as { record?: { stations?: unknown } }).record?.stations;

  if (!Array.isArray(stations)) return [];

  const filter = stationNameFilter.trim().toLowerCase();

  const marketIds: { marketId: string; stationName: string }[] = [];

  for (const row of stations) {
    if (!row || typeof row !== "object") continue;

    const s = row as Record<string, unknown>;

    if (s.has_market !== true) continue;

    const stationName = typeof s.name === "string" ? s.name : "";

    if (filter && !stationName.toLowerCase().includes(filter)) continue;

    const marketId = parseMarketId(s.market_id ?? s.id) ?? "";

    if (!marketId) continue;

    marketIds.push({ marketId, stationName: stationName || marketId });
  }

  if (filter) return marketIds.slice(0, MAX_FILTERED_STATION_MARKETS);

  if (includeAll) return marketIds.slice(0, MAX_ALL_STATION_MARKETS);

  return [];
}

/**

 * Fetch Spansh system JSON exactly as the API returns it (no localization).

 * Commodity index comes from `/api/dump` (fast). Per-station `/api/station` calls are optional.

 */

export async function fetchSpanshSystemDebug(args: {
  systemName: string;

  /** Fetch individual `/api/station/{id}` boards (slow). Default false — dump already has commodities. */

  includeStationMarkets?: boolean;

  /** When set, only fetch station boards whose name contains this substring. */

  stationNameFilter?: string;
}): Promise<SpanshSystemDebugResult> {
  const requested = args.systemName.trim();

  const fetchedAtIso = new Date().toISOString();

  const captures: SpanshRawHttpCapture[] = [];

  if (!requested) {
    return { ok: false, err: "Enter a star system name.", requestedSystem: "", fetchedAtIso, captures };
  }

  const resolved = await resolveSpanshReferenceSystem(requested);

  const norm = normSystemName(resolved || requested);

  const typeaheadUrl = `${SPANSH_BASE}/systems/field_values/system_names?q=${encodeURIComponent(resolved || requested)}`;

  const typeaheadBody = await capture(captures, typeaheadUrl, "GET");

  const hit = id64FromTypeahead(typeaheadBody, norm);

  if (!hit) {
    return {
      ok: false,

      err: `Spansh has no system matching “${resolved || requested}”. Check spelling/casing (e.g. b5-4 not B5-4).`,

      requestedSystem: requested,

      resolvedSystem: resolved || undefined,

      fetchedAtIso,

      captures,
    };
  }

  const systemUrl = `${SPANSH_BASE}/system/${encodeURIComponent(hit.id64)}`;

  const dumpUrl = `${SPANSH_BASE}/dump/${encodeURIComponent(hit.id64)}`;

  const [systemBody, dumpBody] = await Promise.all([
    capture(captures, systemUrl, "GET"),

    capture(captures, dumpUrl, "GET"),
  ]);

  const { hits: commoditySummary, stationsWithMarkets } = extractCommoditySummary(dumpBody);

  const stationFilter = args.stationNameFilter?.trim() ?? "";
  const includeAll = args.includeStationMarkets === true;
  const wantStationApis = includeAll || stationFilter.length > 0;
  const marketIds = wantStationApis
    ? collectStationMarketIds(systemBody, stationFilter, includeAll && !stationFilter)
    : [];

  let stationFetches = 0;

  if (marketIds.length > 0) {
    stationFetches = marketIds.length;

    await mapPool(marketIds, STATION_CONCURRENCY, async (row) => {
      const url = `${SPANSH_BASE}/station/${encodeURIComponent(row.marketId)}`;

      await capture(captures, url, "GET");
    });
  }

  return {
    ok: true,

    requestedSystem: requested,

    resolvedSystem: hit.name,

    systemId64: hit.id64,

    fetchedAtIso,

    stationMarketFetches: stationFetches,

    stationsWithMarkets,

    captures,

    commoditySummary,
  };
}
