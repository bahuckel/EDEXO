import { readMarketJson } from "./marketJson";
import { parseMarketId } from "../../shared/colonize/marketId";

import type { CheckoutFilters } from "../../shared/colonize/types";
import { isConstructionDepotStation } from "../../shared/colonize/constructionDepot";
import { matchesDockedStation } from "../../shared/colonize/stationFilter";
import { isKnownLy, toLy } from "../../shared/colonize/systemDistanceLy";
import { resolveMinDistanceLy } from "./galaxySystemCoords";
import { marketStockMap } from "./localMarketCheckout";
import type { MarketRow, SpanshStationResult, Unified } from "./checkoutStationMap";
import { isKnownShopStation, mergeStation, stationKey } from "./checkoutStationMap";
import type { NeedRow } from "./checkoutRouting";

/** Merge live `Market.json` into the docked station so planner sees what you have on screen. */
export async function enrichStationMapFromDockMarket(
  journalDir: string,
  stationByKey: Map<string, Unified>,
  resolved: NeedRow[],
  filters: CheckoutFilters,
): Promise<void> {
  const docked = filters.dockedStation;
  if (!docked?.stationName?.trim() || !docked.systemName?.trim()) return;

  const read = await readMarketJson(journalDir);
  if (!read.ok) return;
  const j = read.market;

  const stationName = typeof j.StationName === "string" ? j.StationName : "";
  const starSystem = typeof j.StarSystem === "string" ? j.StarSystem : "";
  if (!matchesDockedStation({ systemName: starSystem, stationName }, docked)) return;

  const marketId = parseMarketId(j.MarketID) ?? "";
  const stationType = typeof j.StationType === "string" ? j.StationType : null;
  if (
    isConstructionDepotStation(filters.constructionDepots ?? [], {
      systemName: starSystem,
      stationName,
      marketId,
      stationType,
    })
  ) {
    return;
  }
  const stockMap = marketStockMap(j.Items);

  const market: MarketRow[] = [];
  const provenSpansh = new Set<string>();
  for (const row of resolved) {
    const stock = stockMap.get(row.id);
    if (!stock || stock.stock <= 0) continue;
    provenSpansh.add(row.spansh);
    market.push({ commodity: row.spansh, supply: stock.stock, buy_price: stock.buyPrice ?? undefined });
  }
  if (!provenSpansh.size) return;

  const prevKey = [...stationByKey.values()].find((st) =>
    matchesDockedStation({ systemName: st.systemName, stationName: st.stationName }, docked),
  )?.key;
  const constructionDist = prevKey ? stationByKey.get(prevKey)?.distanceLy : null;
  const pseudo: SpanshStationResult = {
    name: stationName,
    system_name: starSystem,
    market_id: marketId,
    distance: toLy(constructionDist) ?? undefined,
    market,
    type: typeof j.StationType === "string" ? j.StationType : undefined,
  };
  const k = prevKey ?? stationKey(pseudo);
  let merged = prevKey ? stationByKey.get(prevKey) : undefined;
  for (const sp of provenSpansh) {
    merged = mergeStation(merged, pseudo, sp, "journal");
  }
  if (merged) {
    stationByKey.set(k, merged);
  }
}

export async function injectShopMarketSnapshots(
  stationByKey: Map<string, Unified>,
  resolved: NeedRow[],
  filters: CheckoutFilters,
  referenceSystem: string,
): Promise<void> {
  for (const snap of filters.shopMarketSnapshots ?? []) {
    if (
      isConstructionDepotStation(filters.constructionDepots ?? [], {
        systemName: snap.systemName,
        stationName: snap.stationName,
        marketId: snap.marketId,
      })
    ) {
      continue;
    }
    if (!snap.offers.length) continue;
    const provenSpansh = new Set<string>();
    const market: MarketRow[] = [];
    for (const row of resolved) {
      const hit = snap.offers.find((o) => o.commodityId === row.id);
      if (!hit || hit.supply <= 0) continue;
      provenSpansh.add(row.spansh);
      market.push({ commodity: row.spansh, supply: hit.supply, buy_price: hit.buyPrice ?? undefined });
    }
    if (!provenSpansh.size) continue;

    let dist = toLy(snap.constructionDistanceLy);
    if (dist == null) {
      dist = await resolveMinDistanceLy([referenceSystem], snap.systemName);
    }

    const pseudo: SpanshStationResult = {
      name: snap.stationName,
      system_name: snap.systemName,
      market_id: snap.marketId ?? "",
      distance: toLy(dist) ?? undefined,
      market,
    };
    const prevKey = [...stationByKey.values()].find((st) =>
      matchesDockedStation({ systemName: st.systemName, stationName: st.stationName }, snap),
    )?.key;
    const k = prevKey ?? stationKey(pseudo);
    let merged = prevKey ? stationByKey.get(prevKey) : undefined;
    for (const sp of provenSpansh) {
      merged = mergeStation(merged, pseudo, sp, "journal");
    }
    if (merged) stationByKey.set(k, merged);
  }
}

export async function enrichKnownShopDistances(
  stationByKey: Map<string, Unified>,
  referenceSystem: string,
  filters: CheckoutFilters,
): Promise<void> {
  for (const st of stationByKey.values()) {
    if (!isKnownShopStation(filters, st.systemName, st.stationName)) continue;
    if (isKnownLy(st.distanceLy)) continue;
    const d = await resolveMinDistanceLy([referenceSystem], st.systemName);
    if (isKnownLy(d)) st.distanceLy = d;
  }
}
