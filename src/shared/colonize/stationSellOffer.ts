import { commodityNeedMatchesLabel } from "./commodityKey";
import { playerBuyPriceOf, type PlayerBuyPrice } from "./marketPrice";

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type NormalizedSellRow = {
  commodity: string;
  /** Units the station has for sale to the commander. */
  supply: number;
  /** Credits per ton the commander pays (the station's buy price). */
  playerBuyPrice: PlayerBuyPrice | null;
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

  /*
    The commander pays the station's buy price, the one that goes with stock; its sell price goes with demand (what
    it pays you). Market.json, EDDN and Spansh alike (review 2026-11-10 B1): reading sell_price put every Spansh
    seller's cost low by the spread (buy 68 / sell 45 → 45) and dropped carriers with a sell order only (sell 0).
  */
  const playerBuyPrice = playerBuyPriceOf(row);
  if (playerBuyPrice == null) return null;

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
