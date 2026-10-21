import { commodityMergeBucket } from "../../shared/colonize/commodityKey";
import { isConstructionDepotStation } from "../../shared/colonize/constructionDepot";
import { normSystemName } from "../../shared/colonize/stationFilter";
import { isCommanderBuyOffer } from "../../shared/colonize/stationSellOffer";
import type { SpanshDebugCommodityHit } from "../../shared/colonize/spanshSystemDebugTypes";
import type { MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import type { MaterialBuyIndex } from "./materialBuyIndex";

/** Save every buy row from a Spansh system debug dump into the local buy index. */
export async function persistSpanshDebugToBuyIndex(args: {
  index: MaterialBuyIndex;
  marketSystem: string;
  hits: SpanshDebugCommodityHit[];
  referenceSystems: string[];
  constructionDepots?: { marketId?: string; systemName?: string; starSystem?: string; stationName?: string }[];
}): Promise<number> {
  const marketSystem = args.marketSystem.trim();
  if (!marketSystem || !args.hits.length) return 0;

  await args.index.load();
  const refs = [...new Set([marketSystem, ...args.referenceSystems.map((r) => r.trim()).filter(Boolean)])];
  const marketNorm = normSystemName(marketSystem);
  let merged = 0;

  for (const hit of args.hits) {
    const label = hit.commodity.trim();
    if (!label) continue;
    const id = commodityMergeBucket(hit.symbol || label) || commodityMergeBucket(label);
    if (!id) continue;
    const supply = typeof hit.supply === "number" && hit.supply > 0 ? hit.supply : null;
    const buyPrice =
      typeof hit.sellPrice === "number"
        ? hit.sellPrice
        : typeof hit.buyPrice === "number"
          ? hit.buyPrice
          : null;
    if (!isCommanderBuyOffer(supply, buyPrice)) continue;
    const stationName = hit.stationName.trim() || "—";
    if (
      isConstructionDepotStation(args.constructionDepots ?? [], {
        systemName: marketSystem,
        stationName,
        marketId: "",
      })
    ) {
      continue;
    }

    for (const ref of refs) {
      const sameSystem = normSystemName(ref) === marketNorm;
      const stationHit: MaterialBuyStationHit = {
        systemName: marketSystem,
        stationName,
        marketId: "",
        distanceLy: sameSystem ? 0 : null,
        buyPrice,
        supply,
        spanshCommodity: hit.symbol?.trim() || label,
        dataSource: "spansh",
        stationType: null,
        isPlanetaryOrGround: false,
        marketUpdatedAt: null,
        foundAtIso: new Date().toISOString(),
      };
      args.index.mergeStations(ref, id, label, [stationHit]);
      merged += 1;
    }
  }

  if (merged > 0) await args.index.flush();
  return merged;
}
