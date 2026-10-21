/**
 * Phase 9b: a trade party — other commanders' carriers, added by callsign, followed on Spansh.
 *
 * What is knowable about someone else's carrier: where it is, and its market orders (what it
 * sells to you and what it buys). Its full hold is not — that lives in its owner's journal. Spansh
 * learns both from EDDN whenever anyone with an uploader docks there or it jumps with people
 * aboard, and serves them about 15 minutes behind. A live EDDN listener can follow later.
 */
import { resourceNeedId } from "./commodityKey";
import { parseMarketId } from "./marketId";
import { toLy, type Ly } from "./systemDistanceLy";
import { storageGet, storageSet } from "./storage";

/** A carrier callsign: three letters or digits, a dash, three more — "K7Q-N2T". */
const CALLSIGN_RE = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

/** Upper-cased and trimmed if it is a callsign, otherwise null. Accepts a missing dash. */
export function normalizeCallsign(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  const dashed = /^[A-Z0-9]{6}$/.test(s) ? `${s.slice(0, 3)}-${s.slice(3)}` : s;
  return CALLSIGN_RE.test(dashed) ? dashed : null;
}

export type PartyMember = {
  callsign: string;
  /** Whatever the commander wants to remember it by — the owner's name, the carrier's name. */
  note: string;
  addedAt: string;
};

export type PartyOrder = {
  commodityId: string;
  label: string;
  tons: number;
  price: number | null;
};

export type PartyCarrier = {
  callsign: string;
  /** False when Spansh has never heard of this callsign. */
  found: boolean;
  marketId: string | null;
  systemName: string | null;
  /** From the first construction site, when one was given. */
  distanceLy: Ly;
  /** When Spansh last placed the carrier. */
  locationAt: string | null;
  /** When Spansh last saw its market. */
  marketAt: string | null;
  /** What it sells to you, largest first. */
  selling: PartyOrder[];
  /** What it buys from you, largest first. */
  buying: PartyOrder[];
};

export function unknownCarrier(callsign: string): PartyCarrier {
  return {
    callsign,
    found: false,
    marketId: null,
    systemName: null,
    distanceLy: null,
    locationAt: null,
    marketAt: null,
    selling: [],
    buying: [],
  };
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function orders(market: unknown, side: "selling" | "buying"): PartyOrder[] {
  if (!Array.isArray(market)) return [];
  const out: PartyOrder[] = [];
  for (const raw of market) {
    const m = asObj(raw);
    if (!m) continue;
    // A carrier lists commodities with no order on them; only a real quantity is an order.
    const tons = num(side === "selling" ? m.supply : m.demand);
    if (tons == null || tons <= 0) continue;
    const label = str(m.commodity);
    const commodityId = resourceNeedId({ name: label });
    if (!commodityId) continue;
    const price = num(side === "selling" ? m.buy_price : m.sell_price);
    out.push({ commodityId, label, tons, price: price && price > 0 ? price : null });
  }
  return out.sort((a, b) => b.tons - a.tons || a.label.localeCompare(b.label));
}

/**
 * The carrier with exactly this callsign in a Spansh `stations/search` response. A name search
 * also returns near misses ("K7Q-N2T" finds "K7Q-N2X"), so anything but an exact match is ignored.
 */
export function parseSpanshCarrier(payload: unknown, callsign: string): PartyCarrier {
  const results = asObj(payload)?.results;
  if (!Array.isArray(results)) return unknownCarrier(callsign);
  for (const raw of results) {
    const r = asObj(raw);
    if (!r || normalizeCallsign(str(r.name)) !== callsign) continue;
    return {
      callsign,
      found: true,
      marketId: parseMarketId(r.market_id),
      systemName: str(r.system_name) || null,
      distanceLy: toLy(num(r.distance)),
      locationAt: str(r.updated_at) || null,
      marketAt: str(r.market_updated_at) || null,
      selling: orders(r.market, "selling"),
      buying: orders(r.market, "buying"),
    };
  }
  return unknownCarrier(callsign);
}

const PARTY_KEY = "edexo-colonize-trade-party-v1";

export function loadTradeParty(): PartyMember[] {
  try {
    const raw = storageGet(PARTY_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    const out: PartyMember[] = [];
    for (const e of j) {
      const o = asObj(e);
      const callsign = o ? normalizeCallsign(str(o.callsign)) : null;
      if (!o || !callsign || out.some((m) => m.callsign === callsign)) continue;
      out.push({ callsign, note: str(o.note), addedAt: str(o.addedAt) });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveTradeParty(members: PartyMember[]): void {
  try {
    storageSet(PARTY_KEY, JSON.stringify(members));
  } catch {
    /* storage full or blocked: the party lasts for this session only */
  }
}

/** The list with this callsign added (or its note updated); unchanged when it is not a callsign. */
export function addPartyMember(
  members: PartyMember[],
  rawCallsign: string,
  note = "",
  now = new Date(),
): PartyMember[] {
  const callsign = normalizeCallsign(rawCallsign);
  if (!callsign) return members;
  const existing = members.find((m) => m.callsign === callsign);
  if (existing) {
    return note.trim()
      ? members.map((m) => (m.callsign === callsign ? { ...m, note: note.trim() } : m))
      : members;
  }
  return [...members, { callsign, note: note.trim(), addedAt: now.toISOString() }];
}

export function removePartyMember(members: PartyMember[], callsign: string): PartyMember[] {
  return members.filter((m) => m.callsign !== callsign);
}

/** Orders on a party carrier for commodities the commander's sites still need, biggest first. */
export function ordersForNeeds(carrier: PartyCarrier, needIds: ReadonlySet<string>): PartyOrder[] {
  return carrier.selling.filter((o) => needIds.has(o.commodityId));
}
