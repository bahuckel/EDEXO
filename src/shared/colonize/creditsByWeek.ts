/**
 * Credits per system, by the game's week (discuss item 33, owner 2026-10-23: "total paid per system with the weekly
 * ticks"). Two figures, both from the commander's own journal:
 *
 * - **Paid to you**: each delivery's tons times what the site pays per ton for that commodity (the depot's
 *   `Payment`, ColonisationConstructionDepot).
 * - **Spent**: the same tons times the last price the commander paid for that commodity before delivering it
 *   (MarketBuy). Cargo bought from a carrier of his own, or delivered from before the journals on this PC, has no
 *   price: those tons are counted apart (`unpricedTons`) rather than guessed.
 *
 * A week starts Thursday 07:00 UTC, the game's weekly tick.
 */

export type LedgerEntry = { at: string; commodityId: string; tons: number };
export type Purchase = { commodityId: string; buyPrice: number | null; boughtAt: string };

export interface WeekCredits {
  /** The week's Thursday 07:00 UTC, ISO. */
  week: string;
  tons: number;
  paid: number;
  spent: number;
  unpricedTons: number;
}

export interface SystemCredits {
  system: string;
  weeks: WeekCredits[];
  total: { tons: number; paid: number; spent: number; unpricedTons: number };
}

const WEEK_MS = 7 * 86_400_000;
/** A Thursday 07:00 UTC to count from. */
const ANCHOR = Date.UTC(2024, 0, 4, 7, 0, 0);

/** The start of the game week holding this moment: the Thursday 07:00 UTC at or before it. */
export function weekStart(atMs: number): number {
  return ANCHOR + Math.floor((atMs - ANCHOR) / WEEK_MS) * WEEK_MS;
}

/** The commander's buys of each commodity, oldest first, for "the last price before". */
function pricesByCommodity(purchases: readonly Purchase[]): Map<string, { at: number; price: number }[]> {
  const out = new Map<string, { at: number; price: number }[]>();
  for (const p of purchases) {
    const at = Date.parse(p.boughtAt);
    if (p.buyPrice == null || !(p.buyPrice > 0) || !Number.isFinite(at)) continue;
    const list = out.get(p.commodityId) ?? [];
    list.push({ at, price: p.buyPrice });
    out.set(p.commodityId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.at - b.at);
  return out;
}

function priceBefore(list: { at: number; price: number }[] | undefined, atMs: number): number | null {
  if (!list?.length) return null;
  let found: number | null = null;
  for (const p of list) {
    if (p.at > atMs) break;
    found = p.price;
  }
  return found;
}

export function creditsBySystem(
  sites: readonly { starSystem: string | null; payments: ReadonlyMap<string, number>; ledger: readonly LedgerEntry[] }[],
  purchases: readonly Purchase[],
  maxWeeks = 12,
): SystemCredits[] {
  const prices = pricesByCommodity(purchases);
  const bySystem = new Map<string, Map<number, WeekCredits>>();
  for (const site of sites) {
    const system = site.starSystem?.trim();
    if (!system || !site.ledger.length) continue;
    const weeks = bySystem.get(system) ?? new Map<number, WeekCredits>();
    bySystem.set(system, weeks);
    for (const e of site.ledger) {
      const at = Date.parse(e.at);
      if (!Number.isFinite(at) || !(e.tons > 0)) continue;
      const wk = weekStart(at);
      const w = weeks.get(wk) ?? { week: new Date(wk).toISOString(), tons: 0, paid: 0, spent: 0, unpricedTons: 0 };
      weeks.set(wk, w);
      w.tons += e.tons;
      w.paid += e.tons * (site.payments.get(e.commodityId) ?? 0);
      const price = priceBefore(prices.get(e.commodityId), at);
      if (price == null) w.unpricedTons += e.tons;
      else w.spent += e.tons * price;
    }
  }
  const out: SystemCredits[] = [];
  for (const [system, weeks] of bySystem) {
    const all = [...weeks.entries()].sort((a, b) => b[0] - a[0]).map(([, w]) => w);
    const total = all.reduce(
      (t, w) => ({ tons: t.tons + w.tons, paid: t.paid + w.paid, spent: t.spent + w.spent, unpricedTons: t.unpricedTons + w.unpricedTons }),
      { tons: 0, paid: 0, spent: 0, unpricedTons: 0 },
    );
    out.push({ system, weeks: all.slice(0, maxWeeks), total });
  }
  // The system worked on most recently first.
  return out.sort((a, b) => (b.weeks[0]?.week ?? "").localeCompare(a.weeks[0]?.week ?? "") || b.total.tons - a.total.tons);
}
