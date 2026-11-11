/**
 * The two prices on a market row, kept apart in the types (review 2026-11-10 Phase 3, after B1: Spansh's `sell_price`
 * was read as what the commander pays, every seller's cost low by the spread).
 *
 * - {@link PlayerBuyPrice}: credits a ton the commander pays, the station's buy price. It goes with stock/supply.
 *   Market.json `BuyPrice`, EDDN and Spansh `buy_price`, EDSM `buyPrice`.
 * - {@link StationBuyPrice}: credits a ton the station pays the commander, its sell price. It goes with demand.
 *   Market.json `SellPrice`, Spansh `sell_price`, EDSM `sellPrice`.
 *
 * Made only here, from a raw row, so a reader cannot take one key for the other.
 */
declare const priceBrand: unique symbol;
export type PlayerBuyPrice = number & { readonly [priceBrand]: "player-buys" };
export type StationBuyPrice = number & { readonly [priceBrand]: "station-buys" };

function positive(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** What the commander pays on this row, in any source's spelling; null when it lists none (a demand-only row). */
export function playerBuyPriceOf(row: unknown): PlayerBuyPrice | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return (positive(r.buy_price) ?? positive(r.buyPrice) ?? positive(r.BuyPrice)) as PlayerBuyPrice | null;
}

/** What the station pays the commander on this row; null when it lists none. */
export function stationBuyPriceOf(row: unknown): StationBuyPrice | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return (positive(r.sell_price) ?? positive(r.sellPrice) ?? positive(r.SellPrice)) as StationBuyPrice | null;
}
