import { resourceNeedId } from "./commodityKey";

/**
 * What a carrier is holding, derived from the journal.
 *
 * There is no event that says "this carrier holds X tons of Y". Measured over 282 journals:
 * `CargoTransfer` gives per-commodity deltas (`{Type, Count, Direction:"tocarrier"|"toship"}`)
 * and nothing else does; `CarrierStats` gives `SpaceUsage.Cargo`, a total with no breakdown.
 *
 * So the breakdown is accumulated from transfers and the total is read from stats — and the two
 * will not agree, because the replay window starts mid-history and anything loaded before it is
 * invisible. That difference is kept as `unattributedTons` and shown, rather than hidden behind a
 * number that looks exact. A confidently wrong "you already have 400 t" costs a wasted trip.
 */

export type CarrierKind = "fleet" | "squadron" | "unknown";

export type CarrierStock = {
  /** `CarrierID`, which is also the carrier's `MarketID` when you dock at it. */
  carrierId: string;
  kind: CarrierKind;
  name: string;
  callsign: string;
  /** `resourceNeedId` → tons, from transfers seen in the replay window. */
  tonsByCommodity: Record<string, number>;
  /** Display label per commodity id, so the UI need not guess one from the symbol. */
  labels: Record<string, string>;
  /** `SpaceUsage.Cargo` from the last `CarrierStats` — the total we can trust. */
  reportedTons: number | null;
  capacityTons: number | null;
  lastEventIso: string | null;
  /** When the last `CarrierStats` was written: an older one (the history read after a restart) never wins. */
  statsAt?: string | null;
  /**
   * The newest `CargoTransfer` counted into `tonsByCommodity`: an older one is never counted again, so the remembered
   * transfer keys only need to cover the newest second (review 1.3.0: trimming them let a full re-read count twice).
   */
  transfersThrough?: string | null;
};

export function emptyCarrierStock(carrierId: string): CarrierStock {
  return {
    carrierId,
    kind: "unknown",
    name: "",
    callsign: "",
    tonsByCommodity: {},
    labels: {},
    reportedTons: null,
    capacityTons: null,
    lastEventIso: null,
  };
}

/**
 * `CarrierType` is a real journal field — the owner's logs carry `"FleetCarrier"` 288 times — so
 * squadron carriers are expected to report their own value. Nobody here has seen one, so an
 * unrecognised type is kept as a carrier rather than dropped: losing the stock would be worse
 * than colouring it wrong.
 */
export function parseCarrierKind(raw: unknown): CarrierKind {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "unknown";
  if (s.includes("squadron")) return "squadron";
  if (s.includes("fleet")) return "fleet";
  return "unknown";
}

export function carrierDisplayName(c: CarrierStock): string {
  return c.name.trim() || c.callsign.trim() || `Carrier ${c.carrierId}`;
}

/** Tons the breakdown accounts for. */
export function derivedTons(c: CarrierStock): number {
  let total = 0;
  for (const tons of Object.values(c.tonsByCommodity)) total += tons;
  return total;
}

/**
 * Tons the carrier reports holding that no transfer in the window explains.
 *
 * Positive is the normal case — cargo loaded before the replay window. Negative would mean we
 * counted transfers for cargo that has since left by a route we cannot see; both are worth
 * showing, so the sign is preserved.
 */
export function unattributedTons(c: CarrierStock): number | null {
  if (c.reportedTons == null) return null;
  return c.reportedTons - derivedTons(c);
}

function addTons(c: CarrierStock, id: string, label: string, delta: number): void {
  const next = (c.tonsByCommodity[id] ?? 0) + delta;
  if (next > 0) {
    c.tonsByCommodity[id] = next;
    if (label && !c.labels[id]) c.labels[id] = label;
  } else {
    delete c.tonsByCommodity[id];
    delete c.labels[id];
  }
}

export type CargoTransferRow = {
  Type?: unknown;
  Type_Localised?: unknown;
  Count?: unknown;
  Direction?: unknown;
};

/**
 * Apply one `CargoTransfer` event. Returns true when anything changed.
 *
 * The event names no carrier, because you can only transfer with the one you are docked at — so
 * the caller supplies the carrier it belongs to and skips the event when that is unknown.
 */
export function applyCargoTransfer(
  c: CarrierStock,
  transfers: unknown,
  timestampIso: string | null,
): boolean {
  if (!Array.isArray(transfers)) return false;
  let changed = false;
  for (const row of transfers) {
    if (!row || typeof row !== "object") continue;
    const r = row as CargoTransferRow;
    const symbol = typeof r.Type === "string" ? r.Type : "";
    const label = typeof r.Type_Localised === "string" ? r.Type_Localised : "";
    const count = typeof r.Count === "number" ? r.Count : Number(r.Count);
    const direction = String(r.Direction ?? "").toLowerCase();
    if (!symbol || !Number.isFinite(count) || count <= 0) continue;
    /** Only the carrier legs move carrier stock; `tosrv` / `fromsrv` are ship-side. */
    const sign = direction === "tocarrier" ? 1 : direction === "toship" ? -1 : 0;
    if (sign === 0) continue;
    const id = resourceNeedId({ name: symbol, nameLocalised: label || symbol });
    if (!id) continue;
    addTons(c, id, label || symbol, sign * count);
    changed = true;
  }
  if (changed && timestampIso) c.lastEventIso = timestampIso;
  return changed;
}

/** Apply a `CarrierStats` event: identity, capacity, and the total we reconcile against. */
export function applyCarrierStats(c: CarrierStock, j: Record<string, unknown>): boolean {
  let changed = false;
  const kind = parseCarrierKind(j.CarrierType);
  if (kind !== c.kind && (kind !== "unknown" || c.kind === "unknown")) {
    c.kind = kind;
    changed = true;
  }
  const name = typeof j.Name === "string" ? j.Name.trim() : "";
  if (name && name !== c.name) {
    c.name = name;
    changed = true;
  }
  const callsign = typeof j.Callsign === "string" ? j.Callsign.trim() : "";
  if (callsign && callsign !== c.callsign) {
    c.callsign = callsign;
    changed = true;
  }
  const usage = j.SpaceUsage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    const cargo = typeof u.Cargo === "number" ? u.Cargo : null;
    if (cargo != null && cargo !== c.reportedTons) {
      c.reportedTons = cargo;
      changed = true;
    }
    const capacity = typeof u.TotalCapacity === "number" ? u.TotalCapacity : null;
    if (capacity != null && capacity !== c.capacityTons) {
      c.capacityTons = capacity;
      changed = true;
    }
  }
  const ts = typeof j.timestamp === "string" ? j.timestamp : "";
  if (ts && ts !== c.lastEventIso) {
    c.lastEventIso = ts;
    changed = true;
  }
  return changed;
}

/** Identity from `CarrierBuy`, which arrives before the first `CarrierStats`. */
export function applyCarrierBuy(c: CarrierStock, j: Record<string, unknown>): boolean {
  let changed = false;
  const kind = parseCarrierKind(j.CarrierType);
  if (kind !== "unknown" && kind !== c.kind) {
    c.kind = kind;
    changed = true;
  }
  const callsign = typeof j.Callsign === "string" ? j.Callsign.trim() : "";
  if (callsign && callsign !== c.callsign) {
    c.callsign = callsign;
    changed = true;
  }
  return changed;
}

/**
 * Tons available from the carriers the commander has switched on.
 *
 * Deliberately separate from the ship hold: these are two different claims about the world, and
 * merging them early is how "cargo allocated per row instead of per hold" happened before.
 */
export function carrierAvailability(
  carriers: CarrierStock[],
  enabledIds: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of carriers) {
    if (!enabledIds.has(c.carrierId)) continue;
    for (const [id, tons] of Object.entries(c.tonsByCommodity)) {
      if (tons > 0) out.set(id, (out.get(id) ?? 0) + tons);
    }
  }
  return out;
}

/** Ship hold plus whichever carriers are hauling — what the planner may treat as already owned. */
export function mergeAvailability(
  ship: Map<string, number>,
  carrier: Map<string, number>,
): Map<string, number> {
  if (carrier.size === 0) return ship;
  const out = new Map(ship);
  for (const [id, tons] of carrier) out.set(id, (out.get(id) ?? 0) + tons);
  return out;
}

/** Per-carrier tons of one commodity, for the hover breakdown. */
export function carrierTonsFor(
  carriers: CarrierStock[],
  needId: string,
): { carrierId: string; name: string; kind: CarrierKind; tons: number }[] {
  const out: { carrierId: string; name: string; kind: CarrierKind; tons: number }[] = [];
  for (const c of carriers) {
    const tons = c.tonsByCommodity[needId] ?? 0;
    if (tons > 0) out.push({ carrierId: c.carrierId, name: carrierDisplayName(c), kind: c.kind, tons });
  }
  return out;
}
