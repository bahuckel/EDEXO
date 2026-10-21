import { parseMarketId } from "../../shared/colonize/marketId";
import { normalizeConstructionProgress } from "../../shared/colonize/constructionProgress";
import { commodityMergeBucket } from "../../shared/colonize/commodityKey";
import { buildStationEconomyPhrase } from "../../shared/colonize/journalEconomy";
import {
  applyJournalMarketBuyLine,
  applyJournalMarketLine,
  type JournalShopRecord,
} from "../../shared/colonize/journalShopHistory";
import {
  applyCargoTransfer,
  applyCarrierBuy,
  applyCarrierStats,
  emptyCarrierStock,
  type CarrierStock,
} from "../../shared/colonize/carrierStock";
import type { ConstructionDepotRef } from "../../shared/colonize/constructionDepot";
import { isConstructionDepotStation } from "../../shared/colonize/constructionDepot";
import type { DockMarketBrief, LiveDockedInfo, ShipCargoLine, WingRosterEntry } from "../../shared/colonize/types";
import {
  emptyDepot,
  recordContribution,
  syncContributionProgressSample,
  appendProgressHistory,
  type DepotInternal,
  type ResourceInternal,
} from "./depotState";

const COLONISATION_SITE_LABEL_RES: RegExp[] = [
  /^(?:Orbital|Planetary)\s+Construction\s+Site:\s*(.+)$/i,
  /^Ground\s+Installation:\s*(.+)$/i,
  /^Planetary\s+Port:\s*(.+)$/i,
];

function extractColonisationSiteLabel(station: string): string | null {
  const s = station.trim();
  if (!s) return null;
  for (const re of COLONISATION_SITE_LABEL_RES) {
    const m = re.exec(s);
    const inner = m?.[1]?.trim();
    if (inner) return inner;
  }
  return null;
}

function marketIdKeyFromJournal(j: Record<string, unknown>): string | null {
  return parseMarketId(j.MarketID);
}

type LineCtx = {
  starSystem: string | null;
  systemAddress: number | null;
};

/**
 * Wing events name other commanders as plain strings in most journal versions, but some emit
 * `{ Name, ID }` objects — those used to be dropped and the roster came back empty.
 */
function wingMemberName(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object") {
    const name = (raw as { Name?: unknown }).Name;
    if (typeof name === "string") return name.trim();
  }
  return "";
}

function inventoryToMap(inv: unknown): Map<string, ShipCargoLine> {
  const byKey = new Map<string, ShipCargoLine>();
  if (!Array.isArray(inv)) return byKey;
  for (const row of inv) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.Name === "string" ? r.Name : "";
    const nl = typeof r.Name_Localised === "string" ? r.Name_Localised : name;
    const count = typeof r.Count === "number" ? r.Count : 0;
    if (count <= 0 || (!name && !nl)) continue;
    const bucket = commodityMergeBucket(name) || commodityMergeBucket(nl);
    if (!bucket) continue;
    const cur = byKey.get(bucket);
    if (cur) cur.count += count;
    else byKey.set(bucket, { name: name || nl, nameLocalised: nl || name, count });
  }
  return byKey;
}

/**
 * Everything a journal line can change, as a plain record.
 *
 * ColonizeStore owns one of these. Keeping it separate from the class is what lets the
 * reducers below be driven by a test with no Electron app, no disk and no timers — which
 * matters most for the rules that make a replay idempotent.
 */
export type JournalState = {
  depots: Record<string, DepotInternal>;
  journalShops: Map<string, JournalShopRecord>;
  lineCtx: LineCtx;
  liveDocked: LiveDockedInfo;
  lastDockedEconomy: string | null;
  shipCargoByName: Map<string, ShipCargoLine>;
  shipCargoTimestamp: string | null;
  shipCargoCapacity: number | null;
  dockMarket: DockMarketBrief | null;
  wingRoster: WingRosterEntry[];
  /**
   * Carrier stock, keyed by `CarrierID` — which is also the carrier's `MarketID`, so docking at
   * one identifies it. Includes carriers we have only docked at; `confirmedCarrierIds` is what
   * separates ours from a friend's, because `CarrierStats` only ever fires for your own.
   */
  carriers: Record<string, CarrierStock>;
  confirmedCarrierIds: Set<string>;
  /** The carrier we are docked at, since `CargoTransfer` names no carrier of its own. */
  dockedCarrierId: string | null;
  mutationGen: number;
  /**
   * Bumped only when something the store writes to disk changed: depots and journal shops. Cargo,
   * docking, the wing and carriers are rebuilt from the journal, and every `Cargo` event while
   * trading used to rewrite the whole state file for nothing (PERF-M3).
   */
  persistGen: number;
  /** Set by the store so a journal event can ask for the sidecar files to be re-read. */
  requestCargoResync?: () => void;
  requestMarketResync?: () => void;
};

export function createJournalState(): JournalState {
  return {
    depots: {},
    journalShops: new Map(),
    lineCtx: { starSystem: null, systemAddress: null },
    liveDocked: null,
    lastDockedEconomy: null,
    shipCargoByName: new Map(),
    shipCargoTimestamp: null,
    shipCargoCapacity: null,
    dockMarket: null,
    wingRoster: [],
    carriers: {},
    confirmedCarrierIds: new Set(),
    dockedCarrierId: null,
    mutationGen: 0,
    persistGen: 0,
  };
}

/** A depot becomes visible once the journal proves the commander is working on it. */
function engageDepot(state: JournalState, key: string): void {
  const d = state.depots[key];
  if (d && !d.engaged) {
    d.engaged = true;
    state.mutationGen++;
    state.persistGen++;
  }
}

/** Sites the journal has proved the commander is working on — never treated as buy stations. */
export function engagedDepotRefs(state: JournalState): ConstructionDepotRef[] {
  const out: ConstructionDepotRef[] = [];
  for (const d of Object.values(state.depots)) {
    if (!d.engaged) continue;
    out.push({
      marketId: d.marketId,
      starSystem: d.starSystem ?? "",
      stationName: d.stationName ?? "",
      constructionSiteLabel: d.constructionSiteLabel,
    });
  }
  return out;
}

function carrierSlot(state: JournalState, carrierId: string): CarrierStock {
  const existing = state.carriers[carrierId];
  if (existing) return existing;
  const next = emptyCarrierStock(carrierId);
  state.carriers[carrierId] = next;
  return next;
}

/**
 * Only carriers the journal has proved are the commander's own.
 *
 * `CargoTransfer` fires for a friend's carrier exactly as it does for yours, and both look the
 * same from the outside: a dock and some tonnage. `CarrierStats` and `CarrierBuy` only ever
 * concern your own, so confirmation comes from those and unconfirmed stock is never surfaced.
 */
export function ownedCarrierStocks(state: JournalState): CarrierStock[] {
  const out: CarrierStock[] = [];
  for (const id of state.confirmedCarrierIds) {
    const c = state.carriers[id];
    if (c) out.push(c);
  }
  return out.sort((a, b) => a.carrierId.localeCompare(b.carrierId));
}

/** Returns true when the hold actually differs, so an unchanged Cargo event costs no redraw. */
export function replaceShipCargo(
  state: JournalState,
  inv: unknown,
  ts: string | null,
  capacity?: number | null,
): boolean {
  const next = inventoryToMap(inv);
  const cap = capacity != null && Number.isFinite(capacity) && capacity > 0 ? capacity : null;
  const adopt = (): true => {
    state.shipCargoByName = next;
    state.shipCargoTimestamp = ts;
    return true;
  };
  if (cap !== state.shipCargoCapacity) {
    state.shipCargoCapacity = cap;
    return adopt();
  }
  if (ts !== state.shipCargoTimestamp) return adopt();
  if (next.size !== state.shipCargoByName.size) return adopt();
  for (const [k, v] of next) {
    const prev = state.shipCargoByName.get(k);
    if (!prev || prev.count !== v.count) return adopt();
  }
  for (const k of state.shipCargoByName.keys()) {
    if (!next.has(k)) return adopt();
  }
  return false;
}

/**
 * What a depot update can change that is worth saving. Not `lastTimestamp`: the game repeats
 * `ColonisationConstructionDepot` every few seconds while you sit docked at a site — 30,178 of
 * them in the owner's journals — and almost all of them only move the clock.
 */
function depotUpdateSig(d: DepotInternal | undefined): string {
  if (!d) return "";
  return JSON.stringify([
    d.engaged,
    d.stationName,
    d.constructionSiteLabel,
    d.starSystem,
    d.systemAddress,
    d.progress,
    d.complete,
    d.failed,
    d.resources,
    d.progressHistory.length,
    d.contributionProgressHistory.length,
  ]);
}

export function applyJournalLine(state: JournalState, raw: string): boolean {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }
  return applyJournalObject(state, j);
}

/**
 * The same for a line already parsed (EDEXO's live tail hands them over parsed, journalTap.ts). The object may be
 * shared with the rest of the app: nothing here writes to it.
 */
export function applyJournalObject(state: JournalState, j: Record<string, unknown>): boolean {
  const ctx = state.lineCtx;
  let changed = false;
  /** Set alongside `changed` wherever a depot or a journal shop is written. */
  let persist = false;
  const ev = j.event;
  if (ev === "Location" || ev === "FSDJump" || ev === "CarrierJump") {
    if (typeof j.StarSystem === "string" && j.StarSystem !== ctx.starSystem) {
      ctx.starSystem = j.StarSystem;
      changed = true;
    }
    if (typeof j.SystemAddress === "number" && j.SystemAddress !== ctx.systemAddress) {
      ctx.systemAddress = j.SystemAddress;
      changed = true;
    }
  }
  if (ev === "Undocked") {
    if (state.dockedCarrierId != null) {
      state.dockedCarrierId = null;
      changed = true;
    }
    if (state.liveDocked != null) {
      state.liveDocked = null;
      changed = true;
    }
    /**
     * `Market.json` stays on disk after undocking, so without this the app kept reporting the
     * market of the station you just left as if you were still docked there.
     */
    if (state.dockMarket != null) {
      state.dockMarket = null;
      changed = true;
    }
  }
  if (ev === "WingJoin") {
    const ts = typeof j.timestamp === "string" ? j.timestamp : new Date().toISOString();
    const others = Array.isArray(j.Others) ? j.Others : [];
    const next: WingRosterEntry[] = [];
    const seen = new Set<string>();
    for (const other of others) {
      const name = wingMemberName(other);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({ commanderName: name, lastSeenIso: ts });
    }
    state.wingRoster = next;
    changed = true;
  }
  /** A commander joining a wing you are already in only ever produces `WingAdd`. */
  if (ev === "WingAdd") {
    const ts = typeof j.timestamp === "string" ? j.timestamp : new Date().toISOString();
    const candidates = [j.Name, ...(Array.isArray(j.Others) ? j.Others : [])];
    const seen = new Set(state.wingRoster.map((e) => e.commanderName.toLowerCase()));
    const next = [...state.wingRoster];
    for (const candidate of candidates) {
      const name = wingMemberName(candidate);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({ commanderName: name, lastSeenIso: ts });
    }
    if (next.length !== state.wingRoster.length) {
      state.wingRoster = next;
      changed = true;
    }
  }
  if (ev === "WingLeave") {
    if (state.wingRoster.length) {
      state.wingRoster = [];
      changed = true;
    }
  }
  if (ev === "Cargo") {
    const vessel = j.Vessel;
    if (vessel === "Ship") {
      const cap = typeof j.Capacity === "number" ? j.Capacity : null;
      if (Array.isArray(j.Inventory)) {
        if (replaceShipCargo(state, j.Inventory, typeof j.timestamp === "string" ? j.timestamp : null, cap)) {
          changed = true;
        }
      } else {
        state.requestCargoResync?.();
      }
    }
  }
  if (ev === "Market") {
    const starSystem =
      (typeof j.StarSystem === "string" ? j.StarSystem.trim() : "") || ctx.starSystem?.trim() || "";
    const stationName = typeof j.StationName === "string" ? j.StationName.trim() : "";
    const marketId = parseMarketId(j.MarketID);
    if (marketId && stationName && starSystem) {
      const engagedDepots = engagedDepotRefs(state);
      if (
        !isConstructionDepotStation(engagedDepots, {
          marketId,
          systemName: starSystem,
          stationName,
        })
      ) {
        applyJournalMarketLine(state.journalShops, j, ctx.starSystem);
        changed = true;
        persist = true;
      }
      const nextDocked = {
        marketId,
        stationName,
        starSystem,
        timestamp: typeof j.timestamp === "string" ? j.timestamp : null,
      };
      const prevDocked = state.liveDocked;
      if (
        !prevDocked ||
        prevDocked.marketId !== nextDocked.marketId ||
        prevDocked.stationName !== nextDocked.stationName ||
        prevDocked.starSystem !== nextDocked.starSystem
      ) {
        state.liveDocked = nextDocked;
        changed = true;
      }
    }
    state.requestMarketResync?.();
  }
  if (ev === "MarketBuy") {
    const marketId = parseMarketId(j.MarketID);
    const rec = marketId ? state.journalShops.get(marketId) : undefined;
    const buyCtx = rec
      ? { stationName: rec.stationName, starSystem: rec.starSystem, stationType: rec.stationType }
      : state.liveDocked?.stationName && (state.liveDocked.starSystem || ctx.starSystem)
        ? {
            stationName: state.liveDocked.stationName,
            starSystem: (state.liveDocked.starSystem || ctx.starSystem)!.trim(),
            stationType: null as string | null,
          }
        : null;
    const engagedDepots = engagedDepotRefs(state);
    const depotBlocked =
      buyCtx &&
      marketId &&
      isConstructionDepotStation(engagedDepots, {
        marketId,
        systemName: buyCtx.starSystem,
        stationName: buyCtx.stationName,
      });
    if (!depotBlocked) {
      applyJournalMarketBuyLine(state.journalShops, j, buyCtx);
      changed = true;
      persist = true;
    }
    state.requestCargoResync?.();
  }
  if (ev === "MarketSell") {
    state.requestCargoResync?.();
  }
  if (ev === "CarrierStats" || ev === "CarrierBuy") {
    /** Parsed like a MarketID, because it is one: this is what a later `Docked` has to match. */
    const id = parseMarketId(j.CarrierID);
    if (id) {
      const c = carrierSlot(state, id);
      if (!state.confirmedCarrierIds.has(id)) {
        state.confirmedCarrierIds.add(id);
        changed = true;
      }
      if (ev === "CarrierStats" ? applyCarrierStats(c, j) : applyCarrierBuy(c, j)) changed = true;
    }
  }

  /**
   * `CargoTransfer` says what moved and in which direction, but not where — you can only transfer
   * with the carrier you are docked at, so that is what it is attributed to.
   */
  if (ev === "CargoTransfer") {
    const id = state.dockedCarrierId;
    if (id) {
      const ts = typeof j.timestamp === "string" ? j.timestamp : null;
      if (applyCargoTransfer(carrierSlot(state, id), j.Transfers, ts)) changed = true;
    }
  }

  if (ev === "Docked") {
    if (typeof j.StarSystem === "string" && j.StarSystem !== ctx.starSystem) {
      ctx.starSystem = j.StarSystem;
      changed = true;
    }
    if (typeof j.SystemAddress === "number" && j.SystemAddress !== ctx.systemAddress) {
      ctx.systemAddress = j.SystemAddress;
      changed = true;
    }
    const station = typeof j.StationName === "string" ? j.StationName : "";
    const mid = parseMarketId(j.MarketID);
    /** A carrier's MarketID is its CarrierID, so docking is how a transfer finds its carrier. */
    const stationType = String(j.StationType ?? "").toLowerCase();
    const nextDockedCarrier =
      stationType.includes("carrier") ? mid : null;
    if (nextDockedCarrier !== state.dockedCarrierId) {
      state.dockedCarrierId = nextDockedCarrier;
      changed = true;
    }

    const econPhrase = buildStationEconomyPhrase(j);
    if (econPhrase && econPhrase !== state.lastDockedEconomy) {
      state.lastDockedEconomy = econPhrase;
      changed = true;
    }

    if (mid && station) {
      const key = mid;
      const fromPrefix = extractColonisationSiteLabel(station);
      const existing = state.depots[key];

      /** Known colonisation depot (MarketID) — refresh display names on every dock (handles renames). */
      if (existing) {
        engageDepot(state, key);
        const d = existing;
        d.stationName = station;
        d.starSystem = ctx.starSystem ?? d.starSystem;
        d.systemAddress = ctx.systemAddress ?? d.systemAddress;
        if (typeof j.timestamp === "string") d.lastTimestamp = j.timestamp;
        d.constructionSiteLabel = fromPrefix ?? station;
        state.depots[key] = d;
        changed = true;
        persist = true;
      } else if (fromPrefix) {
        engageDepot(state, key);
        const d = state.depots[key] ?? emptyDepot(key);
        d.stationName = station;
        d.constructionSiteLabel = fromPrefix;
        d.starSystem = ctx.starSystem;
        d.systemAddress = ctx.systemAddress;
        if (typeof j.timestamp === "string") d.lastTimestamp = j.timestamp;
        state.depots[key] = d;
        changed = true;
        persist = true;
      }
    }
    if (mid && station) {
      const nextDocked = {
        marketId: mid,
        stationName: station,
        starSystem: ctx.starSystem,
        timestamp: typeof j.timestamp === "string" ? j.timestamp : null,
      };
      const prevDocked = state.liveDocked;
      if (
        !prevDocked ||
        prevDocked.marketId !== nextDocked.marketId ||
        prevDocked.stationName !== nextDocked.stationName ||
        prevDocked.starSystem !== nextDocked.starSystem
      ) {
        state.liveDocked = nextDocked;
        changed = true;
      }
    }
  }
  if (ev === "ColonisationConstructionDepot") {
    const key = marketIdKeyFromJournal(j);
    if (!key) return changed;
    const sigBefore = depotUpdateSig(state.depots[key]);
    engageDepot(state, key);
    const d = state.depots[key] ?? emptyDepot(key);
    const jStation = typeof j.StationName === "string" ? j.StationName.trim() : "";
    const jLoc =
      typeof j.Location_Name === "string"
        ? j.Location_Name.trim()
        : typeof j.LocationName === "string"
          ? j.LocationName.trim()
          : typeof j.ConstructionSiteName === "string"
            ? j.ConstructionSiteName.trim()
            : "";
    if (jStation) {
      d.stationName = jStation;
      const parsedSt = extractColonisationSiteLabel(jStation);
      d.constructionSiteLabel = parsedSt ?? (jLoc || d.constructionSiteLabel || jStation);
    } else if (jLoc) {
      d.constructionSiteLabel = jLoc;
    }
    d.starSystem = ctx.starSystem ?? d.starSystem;
    d.systemAddress = ctx.systemAddress ?? d.systemAddress;
    if (typeof j.ConstructionProgress === "number") {
      const progress = normalizeConstructionProgress(j.ConstructionProgress);
      d.progress = progress;
      appendProgressHistory(d, progress, typeof j.timestamp === "string" ? j.timestamp : null);
    }
    if (typeof j.ConstructionComplete === "boolean") d.complete = j.ConstructionComplete;
    if (typeof j.ConstructionFailed === "boolean") d.failed = j.ConstructionFailed;
    if (typeof j.timestamp === "string") d.lastTimestamp = j.timestamp;
    const rr = j.ResourcesRequired;
    if (Array.isArray(rr)) {
      const next: ResourceInternal[] = [];
      for (const row of rr) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const name = typeof r.Name === "string" ? r.Name : "";
        const nl = typeof r.Name_Localised === "string" ? r.Name_Localised : name;
        const req = typeof r.RequiredAmount === "number" ? r.RequiredAmount : 0;
        const prov = typeof r.ProvidedAmount === "number" ? r.ProvidedAmount : 0;
        const pay = typeof r.Payment === "number" ? r.Payment : null;
        if (name || nl) next.push({ name, nameLocalised: nl, required: req, provided: prov, payment: pay });
      }
      d.resources = next;
      syncContributionProgressSample(d, typeof j.timestamp === "string" ? j.timestamp : null);
    }
    state.depots[key] = d;
    changed = true;
    if (depotUpdateSig(d) !== sigBefore) persist = true;
  }
  if (ev === "ColonisationContribution") {
    const key = marketIdKeyFromJournal(j);
    if (!key) return changed;
    engageDepot(state, key);
    const d = state.depots[key] ?? emptyDepot(key);
    const cStation = typeof j.StationName === "string" ? j.StationName.trim() : "";
    if (cStation) {
      d.stationName = cStation;
      d.constructionSiteLabel = extractColonisationSiteLabel(cStation) ?? cStation;
    }
    d.starSystem = ctx.starSystem ?? d.starSystem;
    d.systemAddress = ctx.systemAddress ?? d.systemAddress;
    if (typeof j.timestamp === "string") d.lastTimestamp = j.timestamp;
    const ts = typeof j.timestamp === "string" ? j.timestamp : null;
    const contribs = j.Contributions;
    if (Array.isArray(contribs)) {
      for (const row of contribs) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const cName = typeof r.Name === "string" ? r.Name : "";
        const cNl = typeof r.Name_Localised === "string" ? r.Name_Localised : cName;
        const amt = typeof r.Amount === "number" ? r.Amount : 0;
        recordContribution(d, cName, cNl, amt, ts);
      }
      syncContributionProgressSample(d, ts);
    }
    state.depots[key] = d;
    changed = true;
    persist = true;
  }
  if (changed) state.mutationGen++;
  if (persist) state.persistGen++;
  return changed;
}
