import type { JournalShopRecord } from "../../shared/colonize/journalShopHistory";
import type { MaterialBuyListing } from "../../shared/colonize/materialBuyIndexTypes";
import type { ConstructionDepotRef } from "../../shared/colonize/constructionDepot";
import type { MaterialBuyIndex } from "./materialBuyIndex";
import { materialBuyHitsForNeed } from "./buyIndexSearch";

export type PlanMaterialNeed = {
  id: string;
  label: string;
  quantityTons: number;
};

/**
 * The plan's sellers: same index + journal merge as Search — one station list per material only.
 */
export function buildPlanMaterialListingsFromIndex(args: {
  index: MaterialBuyIndex;
  journalShops: JournalShopRecord[];
  needs: PlanMaterialNeed[];
  referenceSystem: string;
  distanceOrigin: string;
  distanceBySystem?: Record<string, number>;
  constructionDepots?: ConstructionDepotRef[];
}): MaterialBuyListing[] {
  const ref = args.referenceSystem.trim();
  const distRef = args.distanceOrigin?.trim() || ref;
  const distanceBySystem = args.distanceBySystem ?? {};
  const depots = args.constructionDepots ?? [];
  const out: MaterialBuyListing[] = [];

  for (const need of args.needs) {
    if (!need.id) continue;
    const stations = materialBuyHitsForNeed({
      index: args.index,
      journalShops: args.journalShops,
      needId: need.id,
      needLabel: need.label,
      distanceOrigin: distRef,
      distanceBySystem,
      constructionDepots: depots,
    });
    out.push({
      id: need.id,
      label: need.label,
      quantityNeeded: need.quantityTons,
      servedFromCache:
        stations.length > 0 &&
        (args.index.hasCheckoutData(ref, need.id, need.label) ||
          args.index.hasCheckoutDataAnyRef(need.id, need.label)),
      stations,
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}
