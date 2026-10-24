export type WingCargoClaim = {
  commodityId: string;
  label: string;
  tons: number;
  /** Construction MarketID this haul is destined for (optional). */
  targetDepotMarketId?: string | null;
};

export type WingMember = {
  id: string;
  name: string;
  color: string;
  claims: WingCargoClaim[];
};

/*
  No green (discuss 15a g, owner 2026-10-23): green means done everywhere in Colonize, so the third colour is amber.
  A member saved with the old green shows in amber (wingColor).
*/
const WING_PALETTE = ["#ff7a24", "#5b9bd5", "#ffc94a", "#c77dff", "#4ecdc4", "#ef476f", "#f49ac1"] as const;
const OLD_GREEN = "#7bc96f";

/** A member's colour as drawn: the old green became amber. */
export function wingColor(color: string): string {
  return color.toLowerCase() === OLD_GREEN ? "#ffc94a" : color;
}

export function pickWingColor(index: number): string {
  return WING_PALETTE[index % WING_PALETTE.length] ?? "#ff7a24";
}

/**
 * An EDSM sync's answer laid over what the window holds now (review 2026-10-24): the sync was asked with `before`, and
 * whatever changed in the window while it was out wins. A member whose claims were edited keeps them; one added stays;
 * one removed stays gone. Everyone else takes the sync's claims.
 */
export function mergeWingSync(before: WingMember[], now: WingMember[], synced: WingMember[]): WingMember[] {
  const key = (m: WingMember) => m.name.trim().toLowerCase();
  const sig = (m: WingMember | undefined) => (m ? JSON.stringify(m.claims) : "");
  const was = new Map(before.map((m) => [key(m), m]));
  const is = new Map(now.map((m) => [key(m), m]));
  const out: WingMember[] = [];
  for (const m of synced) {
    const k = key(m);
    const prev = was.get(k);
    const cur = is.get(k);
    if (prev && !cur) continue;
    out.push(cur && sig(cur) !== sig(prev) ? cur : m);
  }
  const have = new Set(out.map(key));
  for (const m of now) if (!have.has(key(m)) && !was.has(key(m))) out.push(m);
  return out;
}

/**
 * Untargeted claims (no `targetDepotMarketId`) form one pool drawn down across depots.
 *
 * They used to be subtracted in full from every depot that wanted the commodity, so a
 * single wing mate hauling 100 t cancelled 100 t of need at each of N sites — the plan
 * under-bought by 100 × (N − 1) tons. Claims that do name a depot still count in full,
 * and only at that depot.
 */
export function makeWingClaimPool(members: WingMember[]): Map<string, number> {
  const pool = new Map<string, number>();
  for (const m of members) {
    for (const c of m.claims) {
      if (c.targetDepotMarketId) continue;
      if (!(c.tons > 0)) continue;
      pool.set(c.commodityId, (pool.get(c.commodityId) ?? 0) + c.tons);
    }
  }
  return pool;
}

/**
 * Tons of `commodityId` already covered by the wing for this depot, consuming from the
 * shared pool. Call in a stable depot order so the allocation is reproducible.
 */
export function consumeWingTonsForDepot(args: {
  members: WingMember[];
  commodityId: string;
  depotMarketId: string | null | undefined;
  untargetedPool: Map<string, number>;
  needTons: number;
}): number {
  const { members, commodityId, depotMarketId, untargetedPool, needTons } = args;
  if (!(needTons > 0)) return 0;

  let targeted = 0;
  for (const m of members) {
    for (const c of m.claims) {
      if (c.commodityId !== commodityId) continue;
      if (!c.targetDepotMarketId) continue;
      if (depotMarketId && c.targetDepotMarketId !== depotMarketId) continue;
      targeted += c.tons;
    }
  }

  let covered = Math.min(needTons, targeted);
  const shortfall = needTons - covered;
  if (shortfall > 0) {
    const available = untargetedPool.get(commodityId) ?? 0;
    const take = Math.min(shortfall, available);
    if (take > 0) {
      untargetedPool.set(commodityId, available - take);
      covered += take;
    }
  }
  return covered;
}
