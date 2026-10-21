import { readMarketJson } from "./marketJson";
import { parseMarketId } from "../../shared/colonize/marketId";
import type { SupplyMarketRow } from "../../shared/colonize/supply/recommendationEngine";
import { buildStationEconomyPhrase } from "../../shared/colonize/journalEconomy";

export type MarketSupplyBriefOk = {
  ok: true;
  /** Journal `MarketID` when parseable */
  marketId: string | null;
  stationName: string;
  starSystem: string;
  stationEconomy: string | null;
  timestamp: string | null;
  rows: SupplyMarketRow[];
};

export type MarketSupplyBriefErr = {
  ok: false;
  err: string;
};

/**
 * Parses last `Market.json` (dock + open commodities screen). Supply row fields vary by exporter;
 * grabs demand/stock clues when present.
 */
const READ_ERRORS = {
  unreadable: "Market.json unreadable (dock + open commodities at target station).",
  invalid: "Market.json invalid JSON.",
  "not-market": "Market.json missing event Market.",
} as const;

export async function readMarketSupplyBrief(journalDir: string): Promise<MarketSupplyBriefOk | MarketSupplyBriefErr> {
  const read = await readMarketJson(journalDir);
  if (!read.ok) return { ok: false, err: READ_ERRORS[read.reason] };
  const j = read.market;

  const stationName = typeof j.StationName === "string" ? j.StationName : "";
  const starSystem = typeof j.StarSystem === "string" ? j.StarSystem : "";
  const ts = typeof j.timestamp === "string" ? j.timestamp : null;

  const marketId = parseMarketId(j.MarketID);

  const stationEconomy = buildStationEconomyPhrase(j);

  const items = j.Items;
  const rows: SupplyMarketRow[] = [];
  if (Array.isArray(items)) {
    for (const row of items) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const name = typeof r.Name === "string" ? r.Name : "";
      const nl = typeof r.Name_Localised === "string" ? r.Name_Localised : name;
      const stock = typeof r.Stock === "number" ? r.Stock : null;
      const demandRaw =
        typeof r.Demand === "number"
          ? r.Demand
          : typeof r.Demand === "string"
            ? Number(String(r.Demand).replace(/,/g, ""))
            : NaN;
      const demand = Number.isFinite(demandRaw) ? demandRaw : null;
      const bracket =
        typeof r.DemandBracket === "string"
          ? r.DemandBracket
          : typeof r.demandBracket === "string"
            ? r.demandBracket
            : typeof r.Demand_rating === "string"
              ? r.Demand_rating
              : null;
      const buyPrice = typeof r.BuyPrice === "number" ? r.BuyPrice : null;
      const sellPrice = typeof r.SellPrice === "number" ? r.SellPrice : null;
      if (!name && !nl) continue;
      rows.push({
        name: name || nl,
        nameLocalised: nl || name,
        stock,
        demandBracket: bracket,
        demand,
        buyPrice,
        sellPrice,
      });
    }
  }

  return {
    ok: true,
    marketId,
    stationName: stationName || "—",
    starSystem: starSystem || "—",
    stationEconomy,
    timestamp: ts,
    rows,
  };
}