/**
 * Find Tritium (R4, owner 2026-10-23): the nearest rings with Tritium hotspots and the nearest stations and carriers
 * selling it, ten of each, from a point (the system picked on the map, else the ship).
 *
 * Two Spansh searches on a press, nothing downloaded: `bodies/search` with `ring_signals` Tritium (about 18 KB for
 * ten bodies) and `stations/search` with Tritium in the market and supply above zero, markets seen in the last 30
 * days (a carrier's market goes stale as soon as it jumps; without the date the nearest "seller" to Sol was a carrier
 * last seen in 2022). Spansh takes `reference_coords`, so the point needs no system name. Held ten minutes per point.
 */
import { TtlCache } from "../shared/colonize/ttlCache.js";
import { fetchJson, spanshGate } from "./colonize/httpGate.js";

const BODIES_SEARCH = "https://spansh.co.uk/api/bodies/search";
const STATIONS_SEARCH = "https://spansh.co.uk/api/stations/search";
const TIMEOUT_MS = 20_000;
const LIMIT = 10;
/** A seller's market older than this is not listed. */
export const TRITIUM_MARKET_MAX_AGE_DAYS = 30;

export interface TritiumRing {
  system: string;
  body: string;
  ring: string;
  ringType: string;
  hotspots: number;
  distanceLy: number;
  /** The body from the arrival star. */
  distanceLs: number | null;
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface TritiumSeller {
  system: string;
  station: string;
  type: string;
  carrier: boolean;
  pad: "L" | "M" | "S" | "";
  distanceLy: number;
  distanceLs: number | null;
  supply: number;
  /** What the commander pays, per tonne. */
  price: number;
  updatedAt: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface TritiumResult {
  from: { x: number; y: number; z: number };
  rings: TritiumRing[];
  sellers: TritiumSeller[];
  /** Set when one of the two searches failed; the other list still stands. */
  errors: string[];
}

type Obj = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const results = (payload: unknown): Obj[] =>
  payload && typeof payload === "object" && Array.isArray((payload as Obj).results)
    ? ((payload as Obj).results as unknown[]).filter((r): r is Obj => !!r && typeof r === "object")
    : [];

/** Every ring with a Tritium hotspot, in the bodies' order (nearest first). */
export function tritiumRingsFrom(payload: unknown, limit = LIMIT): TritiumRing[] {
  const out: TritiumRing[] = [];
  for (const b of results(payload)) {
    const rings = Array.isArray(b.rings) ? (b.rings as Obj[]) : [];
    for (const r of rings) {
      const signals = Array.isArray(r.signals) ? (r.signals as Obj[]) : [];
      const hotspots = signals.filter((s) => str(s.name) === "Tritium").reduce((n, s) => n + (num(s.count) ?? 0), 0);
      if (hotspots <= 0) continue;
      out.push({
        system: str(b.system_name),
        body: str(b.name),
        ring: str(r.name),
        ringType: str(r.type),
        hotspots,
        distanceLy: num(b.distance) ?? 0,
        distanceLs: num(b.distance_to_arrival),
        x: num(b.system_x),
        y: num(b.system_y),
        z: num(b.system_z),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function padOf(s: Obj): TritiumSeller["pad"] {
  if ((num(s.large_pads) ?? 0) > 0 || s.has_large_pad === true) return "L";
  if ((num(s.medium_pads) ?? 0) > 0) return "M";
  if ((num(s.small_pads) ?? 0) > 0) return "S";
  return "";
}

/** Stations and carriers with Tritium in stock, in Spansh's order (nearest first). */
export function tritiumSellersFrom(payload: unknown, limit = LIMIT): TritiumSeller[] {
  const out: TritiumSeller[] = [];
  for (const s of results(payload)) {
    const market = Array.isArray(s.market) ? (s.market as Obj[]) : [];
    const row = market.find((m) => str(m.commodity) === "Tritium");
    const supply = num(row?.supply) ?? 0;
    if (!row || supply <= 0) continue;
    const type = str(s.type);
    out.push({
      system: str(s.system_name),
      station: str(s.name),
      type,
      carrier: /carrier/i.test(type),
      pad: padOf(s),
      distanceLy: num(s.distance) ?? 0,
      distanceLs: num(s.distance_to_arrival),
      supply,
      price: num(row.buy_price) ?? 0,
      updatedAt: str(s.market_updated_at) || null,
      x: num(s.system_x),
      y: num(s.system_y),
      z: num(s.system_z),
    });
    if (out.length >= limit) break;
  }
  return out;
}

const cache = new TtlCache<string, TritiumResult>({ max: 20, ttlMs: 10 * 60 * 1000 });

export async function findTritium(from: { x: number; y: number; z: number }, nowMs = Date.now()): Promise<TritiumResult> {
  const key = `${Math.round(from.x)},${Math.round(from.y)},${Math.round(from.z)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const reference_coords = { x: from.x, y: from.y, z: from.z };
  const since = new Date(nowMs - TRITIUM_MARKET_MAX_AGE_DAYS * 86_400_000).toISOString();
  const errors: string[] = [];
  const say = (what: string) => (e: unknown) => {
    errors.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  };
  const [bodies, stations] = await Promise.all([
    fetchJson(spanshGate, BODIES_SEARCH, {
      timeoutMs: TIMEOUT_MS,
      body: {
        filters: { ring_signals: [{ name: "Tritium", value: [1, 9999], comparison: "<=>" }] },
        sort: [{ distance: { direction: "asc" } }],
        size: LIMIT,
        page: 0,
        reference_coords,
      },
    }).catch(say("Rings")),
    fetchJson(spanshGate, STATIONS_SEARCH, {
      timeoutMs: TIMEOUT_MS,
      body: {
        filters: {
          market: [{ name: "Tritium", supply: { value: ["1", "999999999"], comparison: "<=>" } }],
          market_updated_at: { value: [since, "2100-01-01T00:00:00Z"], comparison: "<=>" },
        },
        sort: [{ distance: { direction: "asc" } }],
        size: LIMIT,
        page: 0,
        reference_coords,
      },
    }).catch(say("Sellers")),
  ]);
  const result: TritiumResult = {
    from: reference_coords,
    rings: bodies ? tritiumRingsFrom(bodies) : [],
    sellers: stations ? tritiumSellersFrom(stations) : [],
    errors,
  };
  if (!errors.length) cache.set(key, result);
  return result;
}
