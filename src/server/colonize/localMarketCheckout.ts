import { readMarketJson } from "./marketJson";
import { parseMarketId } from "../../shared/colonize/marketId";
import { commodityMergeBucket } from "../../shared/colonize/commodityKey";
import { isConstructionDepotStation } from "../../shared/colonize/constructionDepot";
import type { BasketCheckoutItem, CheckoutFilters, BasketCheckoutResult } from "../../shared/colonize/types";

type MarketJsonRow = {
  Name?: string;
  Name_Localised?: string;
  Stock?: number;
  BuyPrice?: number;
  SellPrice?: number;
};

/** Stock and price for sale at the station (`Stock` > 0 in Market.json`). */
export function marketStockMap(items: unknown): Map<string, { stock: number; buyPrice: number | null }> {
  const m = new Map<string, { stock: number; buyPrice: number | null }>();
  if (!Array.isArray(items)) return m;
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const r = row as MarketJsonRow;
    const nl = typeof r.Name_Localised === "string" ? r.Name_Localised : "";
    const n = typeof r.Name === "string" ? r.Name : "";
    const stock = typeof r.Stock === "number" ? r.Stock : 0;
    if (stock <= 0) continue;
    const bucket = commodityMergeBucket(nl) || commodityMergeBucket(n);
    if (!bucket) continue;
    // BuyPrice is what the commander pays (with Stock); SellPrice is what the market pays (with Demand).
    const buyPrice = typeof r.BuyPrice === "number" && r.BuyPrice > 0 ? r.BuyPrice : null;
    if (buyPrice == null) continue;
    const prev = m.get(bucket);
    if (!prev || stock > prev.stock) m.set(bucket, { stock, buyPrice });
  }
  return m;
}

/**
 * If the latest `Market.json` lists every basket commodity with enough stock, return a single 0 Ly visit plan.
 */
export async function tryCheckoutFromMarketJson(
  journalDir: string,
  uniqueItems: BasketCheckoutItem[],
  filters?: Partial<CheckoutFilters>,
): Promise<BasketCheckoutResult | null> {
  if (uniqueItems.length === 0) return null;
  const read = await readMarketJson(journalDir);
  if (!read.ok) return null;
  const j = read.market;

  const stockMap = marketStockMap(j.Items);
  for (const it of uniqueItems) {
    const row = stockMap.get(it.id);
    if (!row || row.stock <= 0) return null;
  }

  const stationName = typeof j.StationName === "string" ? j.StationName : "";
  const starSystem = typeof j.StarSystem === "string" ? j.StarSystem : "";
  const marketId = parseMarketId(j.MarketID) ?? "";
  const stationType = typeof j.StationType === "string" ? j.StationType : null;
  if (
    isConstructionDepotStation(filters?.constructionDepots ?? [], {
      systemName: starSystem,
      stationName,
      marketId,
      stationType,
    })
  ) {
    return null;
  }

  const commodities = uniqueItems.map((it) => {
    const row = stockMap.get(it.id)!;
    const label = (it.nameLocalised || it.name).trim() || it.name;
    return {
      id: it.id,
      label,
      spanshCommodity: label,
      quantityNeeded: Math.max(1, Math.ceil(it.quantityTons || 1)),
      buyPrice: row.buyPrice,
      supply: row.stock,
      dataSource: "journal" as const,
    };
  });

  let estimatedCost: number | null = 0;
  for (const c of commodities) {
    if (c.buyPrice == null) {
      estimatedCost = null;
      break;
    }
    estimatedCost! += c.buyPrice * c.quantityNeeded;
  }

  return {
    referenceSystem: starSystem,
    groups: [
      {
        groupIndex: 0,
        systemName: starSystem || "—",
        stationName: stationName || "—",
        distanceLy: 0,
        marketId,
        commodityIds: uniqueItems.map((x) => x.id),
        commodityLabels: commodities.map((c) => c.label),
        spanshCommodities: commodities.map((c) => c.spanshCommodity),
        commodities,
        estimatedCost,
        marketUpdatedAt: typeof j.timestamp === "string" ? j.timestamp : null,
      },
    ],
    unresolved: [],
    dataSource: "market_json",
    marketTimestamp: typeof j.timestamp === "string" ? j.timestamp : null,
  };
}
