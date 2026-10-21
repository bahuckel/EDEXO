import { commodityNeedMatchesLabel } from "./commodityKey";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type NormalizedSellRow = {
  commodity: string;
  /** Units the station has for sale to the commander. */
  supply: number;
  /** Credits per ton the commander pays (station sell price). */
  playerBuyPrice: number | null;
};

/**
 * Parse a market row for commander purchase (station sells to you).
 * Rejects demand-only rows (supply/stock <= 0) — those are stations that buy from you.
 */
export function parseMarketRowForPlayerBuy(raw: unknown): NormalizedSellRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const commodity =
    typeof row.commodity === "string"
      ? row.commodity
      : typeof row.name === "string"
        ? row.name
        : typeof row.symbol === "string"
          ? row.symbol
          : "";
  if (!commodity.trim()) return null;

  const supply = num(row.supply) ?? num(row.stock) ?? num(row.Stock) ?? 0;
  if (supply <= 0) return null;

  // Commander pays the station's SellPrice only — BuyPrice is demand (station buys from you).
  const playerBuyPrice = num(row.sell_price) ?? num(row.sellPrice) ?? num(row.SellPrice) ?? null;
  if (playerBuyPrice == null || playerBuyPrice <= 0) return null;

  return { commodity: commodity.trim(), supply, playerBuyPrice };
}

/** True when a listing row proves the station sells to the commander (not demand-only). */
export function isCommanderBuyOffer(supply: number | null | undefined, buyPrice: number | null | undefined): boolean {
  return (supply ?? 0) > 0 && buyPrice != null && buyPrice > 0;
}

export function marketRowsForPlayerBuy(market: unknown): NormalizedSellRow[] {
  if (!Array.isArray(market)) return [];
  const out: NormalizedSellRow[] = [];
  for (const raw of market) {
    const parsed = parseMarketRowForPlayerBuy(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** True when a station market lists this need with stock for sale (supply > 0). */
export function stationMarketSellsNeed(
  market: unknown,
  need: { id: string; label: string },
  spanshCommodity?: string,
): boolean {
  for (const row of marketRowsForPlayerBuy(market)) {
    if (spanshCommodity && row.commodity === spanshCommodity) return true;
    if (commodityNeedMatchesLabel(need.id, need.label, row.commodity)) return true;
  }
  return false;
}
