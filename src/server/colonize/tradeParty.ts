/** Phase 9b: where each trade-party carrier is and what it trades, from Spansh. */
import { mapPool } from "../../shared/colonize/mapPool";
import { normSystemName } from "../../shared/colonize/stationFilter";
import { normalizeCallsign, parseSpanshCarrier, type PartyCarrier } from "../../shared/colonize/tradeParty";
import { TtlCache } from "../../shared/colonize/ttlCache";
import { fetchJson, spanshGate } from "./httpGate";

const SPANSH_STATIONS_SEARCH = "https://spansh.co.uk/api/stations/search";
const TIMEOUT_MS = 20_000;
/** A party is a handful of carriers; more than this is a paste gone wrong. */
const MAX_CARRIERS = 40;

/**
 * Spansh is about 15 minutes behind EDDN, and the panel refreshes every few minutes; two minutes
 * absorbs repeat clicks without hiding anything Spansh could have told us.
 */
const carrierCache = new TtlCache<string, PartyCarrier>({ max: 200, ttlMs: 2 * 60 * 1000 });

async function lookUpOne(callsign: string, referenceSystem: string): Promise<PartyCarrier> {
  const key = `${callsign}|${normSystemName(referenceSystem)}`;
  const cached = carrierCache.get(key);
  if (cached) return cached;
  const body: Record<string, unknown> = { filters: { name: { value: callsign } }, size: 10 };
  if (referenceSystem) body.reference_system = referenceSystem;
  const carrier = parseSpanshCarrier(
    await fetchJson(spanshGate, SPANSH_STATIONS_SEARCH, { timeoutMs: TIMEOUT_MS, body }),
    callsign,
  );
  carrierCache.set(key, carrier);
  return carrier;
}

/** One entry per valid callsign, in the order given. A failed look-up fails the whole call. */
export async function lookUpPartyCarriers(
  callsigns: string[],
  referenceSystem = "",
): Promise<PartyCarrier[]> {
  const unique = [...new Set(callsigns.map(normalizeCallsign).filter((c): c is string => c != null))].slice(
    0,
    MAX_CARRIERS,
  );
  return mapPool(unique, 2, (c) => lookUpOne(c, referenceSystem.trim()));
}
