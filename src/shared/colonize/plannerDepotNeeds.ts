import { combinedMissingWithQty } from "./basketGap";
import type { MaterialBuyListing } from "./materialBuyIndexTypes";
import { mergeMaterialListings } from "./mergeCheckoutPlans";
import type { BasketCheckoutResult, DepotSnapshot } from "./types";

export type DepotNeedItem = {
  id: string;
  name: string;
  nameLocalised: string;
  quantityTons: number;
};

export function depotNeedLabel(need: Pick<DepotNeedItem, "name" | "nameLocalised">): string {
  return (need.nameLocalised || need.name).trim() || need.name;
}

/** Every material still needed across active construction projects (ignores basket). */
export function depotNeedsFromProjects(
  depots: DepotSnapshot[],
  cargoByKey: Map<string, number>,
): DepotNeedItem[] {
  return combinedMissingWithQty(depots, cargoByKey);
}

/** Ensure every open-project need appears in planner listings — union with checkout data. */
function enrichMaterialListingsForDepotNeeds(
  needs: DepotNeedItem[],
  listings: MaterialBuyListing[],
): MaterialBuyListing[] {
  const byId = new Map(listings.map((m) => [m.id, { ...m }]));
  for (const need of needs) {
    const label = (need.nameLocalised || need.name).trim() || need.name;
    const prev = byId.get(need.id);
    if (!prev) {
      byId.set(need.id, {
        id: need.id,
        label,
        quantityNeeded: need.quantityTons,
        stations: [],
        servedFromCache: false,
      });
      continue;
    }
    prev.quantityNeeded = Math.max(prev.quantityNeeded, need.quantityTons);
    if (!prev.label.trim()) prev.label = label;
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Planner checkouts are always depot-driven: bundle scans for open projects,
 * never the manual basket checkout snapshot.
 */
export function buildPlannerCheckouts(args: {
  depotNeeds: DepotNeedItem[];
  bundlePlans: BasketCheckoutResult[];
  fallbackReferenceSystem: string;
}): BasketCheckoutResult[] {
  if (args.bundlePlans.length) {
    return args.bundlePlans.map((plan) => ({
      ...plan,
      materialListings: enrichMaterialListingsForDepotNeeds(
        args.depotNeeds,
        plan.materialListings ?? [],
      ),
      groups: plan.groups ?? [],
      catalogStations: plan.catalogStations ?? [],
    }));
  }

  const mergedStations = mergeMaterialListings(args.bundlePlans);
  const materialListings = enrichMaterialListingsForDepotNeeds(args.depotNeeds, mergedStations);

  const ref = args.fallbackReferenceSystem.trim();
  if (!ref && !materialListings.length) return [];

  return [
    {
      referenceSystem: ref || "unknown",
      groups: [],
      catalogStations: [],
      materialListings,
      unresolved: materialListings
        .filter((m) => !m.stations.length)
        .map((m) => ({ id: m.id, label: m.label, quantityNeeded: m.quantityNeeded, tried: [] })),
    },
  ];
}
