import type {
  BasketCheckoutResult,
  CheckoutCommodityOffer,
  CheckoutFilters,
  CheckoutRoutingMode,
  CheckoutStationCatalogEntry,
  CheckoutStationGroup,
} from "../../shared/colonize/types";
import { compareLy, isKnownLy, toLy, type Ly } from "../../shared/colonize/systemDistanceLy";
import type { NearestHit, Unified } from "./checkoutStationMap";
import {
  isKnownShopStation,
  marketRowForCommodity,
  stationHasProvenCommodity,
  stationRowCompatibleWithCommodity,
  stationSellsNeed,
} from "./checkoutStationMap";

export type NeedRow = { id: string; label: string; spansh: string; quantityTons: number };

function buildCommodityOffers(st: Unified, cover: NeedRow[]): CheckoutCommodityOffer[] {
  return cover.map((row) => {
    const offer = marketRowForCommodity(st.market, row.spansh, 1, null, {
      id: row.id,
      label: row.label,
    });
    return {
      id: row.id,
      label: row.label,
      spanshCommodity: row.spansh,
      quantityNeeded: row.quantityTons,
      buyPrice: offer?.buyPrice ?? null,
      supply: offer?.supply ?? null,
      dataSource: st.commoditySources.get(row.spansh) ?? "spansh",
    };
  });
}

/** Nearest station that sells each basket line (any stock &gt; 0). */
export function buildNearestStopPerItem(
  stationByKey: Map<string, Unified>,
  preNeeds: Array<{ id: string; label: string; quantityTons: number }>,
  filters: CheckoutFilters,
  triedById: Map<string, string[]>,
  nearestHitByNeed: Map<string, NearestHit>,
): { groups: CheckoutStationGroup[]; unresolved: BasketCheckoutResult["unresolved"] } {
  const groups: CheckoutStationGroup[] = [];
  const unresolved: BasketCheckoutResult["unresolved"] = [];

  for (const need of preNeeds) {
    if (!need.id) {
      unresolved.push({
        id: need.label,
        label: need.label,
        quantityNeeded: need.quantityTons,
        tried: ["edsm", "spansh"],
      });
      continue;
    }

    let bestKey: string | null = null;
    let bestDist: Ly = null;
    let bestSell: ReturnType<typeof stationSellsNeed> = null;

    const recorded = nearestHitByNeed.get(need.id);
    if (recorded) {
      const st = stationByKey.get(recorded.stationKey);
      if (st) {
        bestKey = recorded.stationKey;
        bestDist = toLy(recorded.distanceLy);
        bestSell =
          stationSellsNeed(st, need, recorded.spansh) ??
          ({
            spansh: recorded.spansh,
            buyPrice: null,
            supply: null,
            source: recorded.source,
          } as const);
      }
    }

    if (!bestKey) {
      for (const [key, st] of stationByKey) {
        const sell = stationSellsNeed(st, need);
        if (!sell) continue;
        if (bestKey == null || compareLy(st.distanceLy, bestDist) < 0) {
          bestDist = st.distanceLy;
          bestKey = key;
          bestSell = sell;
        }
      }
    }

    if (!bestKey || !bestSell) {
      unresolved.push({
        id: need.id,
        label: need.label,
        quantityNeeded: need.quantityTons,
        tried: triedById.get(need.id) ?? ["edsm", "spansh"],
      });
      continue;
    }

    const st = stationByKey.get(bestKey)!;
    const row: NeedRow = {
      id: need.id,
      label: need.label,
      spansh: bestSell.spansh,
      quantityTons: need.quantityTons,
    };
    const group = groupFromStop(st, [row], groups.length);
    if (group.commodities[0]) group.commodities[0].dataSource = bestSell.source;
    groups.push(group);
  }

  return { groups, unresolved };
}

/** One nearest buy stop per commodity the router skipped but the catalog still has. */
export function appendNearestStopsForMissing(
  groups: CheckoutStationGroup[],
  stationByKey: Map<string, Unified>,
  need: NeedRow[],
  filters: CheckoutFilters,
  itemIds: string[],
): CheckoutStationGroup[] {
  const covered = new Set<string>();
  for (const g of groups) {
    for (const id of g.commodityIds) covered.add(id);
  }

  const out = [...groups];
  let nextIdx = groups.length;

  for (const id of itemIds) {
    if (!id || covered.has(id)) continue;
    const row = need.find((n) => n.id === id);
    if (!row) continue;

    let bestKey: string | null = null;
    let bestDist: Ly = null;

    for (const [key, st] of stationByKey) {
      if (!stationHasProvenCommodity(st, row.spansh)) continue;
      const compatible =
        stationRowCompatibleWithCommodity(st, row.spansh, row.quantityTons, filters.minSupply, {
          id: row.id,
          label: row.label,
        }) ||
        st.commoditySources.get(row.spansh) === "edsm" ||
        st.commoditySources.get(row.spansh) === "journal";
      if (!compatible) continue;
      if (bestKey == null || compareLy(st.distanceLy, bestDist) < 0) {
        bestDist = st.distanceLy;
        bestKey = key;
      }
    }

    if (!bestKey) continue;
    const st = stationByKey.get(bestKey)!;
    out.push(groupFromStop(st, [row], nextIdx++));
    covered.add(id);
  }

  return out;
}

export function buildCatalogFromStationMap(
  stationByKey: Map<string, Unified>,
  resolved: Array<{ id: string; label: string; spansh: string; quantityTons: number }>,
  filters: CheckoutFilters,
): CheckoutStationCatalogEntry[] {
  const out: CheckoutStationCatalogEntry[] = [];
  for (const st of stationByKey.values()) {
    const commodities: CheckoutStationCatalogEntry["commodities"] = [];
    const known = isKnownShopStation(filters, st.systemName, st.stationName);
    for (const row of resolved) {
      if (!stationHasProvenCommodity(st, row.spansh)) continue;
      if (
        !stationRowCompatibleWithCommodity(st, row.spansh, 1, null, {
          id: row.id,
          label: row.label,
        }) &&
        !known
      ) {
        continue;
      }
      const offer = marketRowForCommodity(st.market, row.spansh, 1, null, {
      id: row.id,
      label: row.label,
    });
      if (!offer && st.market.length > 0 && !known) continue;
      if (!offer && known && stationHasProvenCommodity(st, row.spansh)) {
        commodities.push({
          id: row.id,
          label: row.label,
          spanshCommodity: row.spansh,
          quantityNeeded: row.quantityTons,
          buyPrice: null,
          supply: row.quantityTons,
          dataSource: st.commoditySources.get(row.spansh) ?? "journal",
        });
        continue;
      }
      if (!offer) continue;
      commodities.push({
        id: row.id,
        label: row.label,
        spanshCommodity: row.spansh,
        quantityNeeded: row.quantityTons,
        buyPrice: offer?.buyPrice ?? null,
        supply: offer?.supply ?? null,
        dataSource: st.commoditySources.get(row.spansh) ?? "spansh",
      });
    }
    if (!commodities.length) continue;
    out.push({
      systemName: st.systemName || "—",
      stationName: st.stationName || "—",
      marketId: st.marketId,
      distanceLy: toLy(st.distanceLy),
      isPlanetaryOrGround: st.isPlanetaryOrGround,
      stationType: st.stationType,
      bodyName: st.bodyName,
      commodities,
    });
  }
  return out.sort((a, b) => compareLy(a.distanceLy, b.distanceLy) || a.stationName.localeCompare(b.stationName));
}

function groupFromStop(st: Unified, cover: NeedRow[], groupIndex: number): CheckoutStationGroup {
  const commodities = buildCommodityOffers(st, cover);
  let estimatedCost: number | null = 0;
  for (const c of commodities) {
    if (c.buyPrice == null) {
      estimatedCost = null;
      break;
    }
    estimatedCost! += c.buyPrice * c.quantityNeeded;
  }
  return {
    groupIndex,
    systemName: st.systemName || "—",
    stationName: st.stationName || "—",
    distanceLy: toLy(st.distanceLy),
    marketId: st.marketId,
    commodityIds: cover.map((x) => x.id),
    commodityLabels: cover.map((x) => x.label),
    spanshCommodities: cover.map((x) => x.spansh),
    commodities,
    estimatedCost,
    isPlanetaryOrGround: st.isPlanetaryOrGround,
    stationType: st.stationType,
    bodyName: st.bodyName,
    marketUpdatedAt: st.marketUpdatedAt,
  };
}

function greedyFewestStops(stationByKey: Map<string, Unified>, need: NeedRow[], filters: CheckoutFilters): CheckoutStationGroup[] {
  const remaining = new Map(need.map((x) => [x.id, x] as const));
  const groups: CheckoutStationGroup[] = [];

  while (remaining.size > 0) {
    let bestKey: string | null = null;
    let bestCover: NeedRow[] = [];
    let bestDist: Ly = null;

    for (const [sKey, st] of stationByKey) {
      const covers: NeedRow[] = [];
      for (const [_id, row] of remaining) {
        if (!stationHasProvenCommodity(st, row.spansh)) continue;
        if (
          !stationRowCompatibleWithCommodity(st, row.spansh, row.quantityTons, filters.minSupply, {
            id: row.id,
            label: row.label,
          })
        ) {
          continue;
        }
        covers.push(row);
      }
      if (covers.length === 0) continue;
      if (
        covers.length > bestCover.length ||
        (covers.length === bestCover.length && compareLy(st.distanceLy, bestDist) < 0)
      ) {
        bestKey = sKey;
        bestCover = covers;
        bestDist = st.distanceLy;
      }
    }

    if (!bestKey || bestCover.length === 0) break;
    const st = stationByKey.get(bestKey)!;
    for (const c of bestCover) remaining.delete(c.id);
    groups.push(groupFromStop(st, bestCover, groups.length));
  }
  return groups;
}

function routeNearest(stationByKey: Map<string, Unified>, need: NeedRow[], filters: CheckoutFilters): CheckoutStationGroup[] {
  const remaining = new Map(need.map((x) => [x.id, x] as const));
  const groups: CheckoutStationGroup[] = [];

  while (remaining.size > 0) {
    let bestKey: string | null = null;
    let bestRow: NeedRow | null = null;
    let bestDist: Ly = null;

    for (const [_id, row] of remaining) {
      for (const [sKey, st] of stationByKey) {
        if (!stationHasProvenCommodity(st, row.spansh)) continue;
        if (
          !stationRowCompatibleWithCommodity(st, row.spansh, row.quantityTons, filters.minSupply, {
            id: row.id,
            label: row.label,
          })
        ) {
          continue;
        }
        if (bestKey == null || compareLy(st.distanceLy, bestDist) < 0) {
          bestDist = st.distanceLy;
          bestKey = sKey;
          bestRow = row;
        }
      }
    }

    if (!bestKey || !bestRow) break;
    const st = stationByKey.get(bestKey)!;
    remaining.delete(bestRow.id);
    groups.push(groupFromStop(st, [bestRow], groups.length));
  }
  return groups;
}

function routeCheapest(stationByKey: Map<string, Unified>, need: NeedRow[], filters: CheckoutFilters): CheckoutStationGroup[] {
  const remaining = new Map(need.map((x) => [x.id, x] as const));
  const groups: CheckoutStationGroup[] = [];

  while (remaining.size > 0) {
    let bestKey: string | null = null;
    let bestCover: NeedRow[] = [];
    let bestScore = 0;
    let bestKnown = false;

    for (const [sKey, st] of stationByKey) {
      const covers: NeedRow[] = [];
      let cost = 0;
      let hasAllPrices = true;
      for (const [_id, row] of remaining) {
        if (!stationHasProvenCommodity(st, row.spansh)) continue;
        if (
          !stationRowCompatibleWithCommodity(st, row.spansh, row.quantityTons, filters.minSupply, {
            id: row.id,
            label: row.label,
          })
        ) {
          continue;
        }
        const offer = marketRowForCommodity(st.market, row.spansh, row.quantityTons, filters.minSupply, {
          id: row.id,
          label: row.label,
        });
        covers.push(row);
        if (!offer || offer.buyPrice == null) hasAllPrices = false;
        else cost += offer.buyPrice * row.quantityTons;
      }
      if (covers.length === 0) continue;
      /**
       * A seller whose distance is known always beats one whose distance is not (the S-7 rule:
       * unknown sorts after every known), and unknown ones are compared on price alone.
       *
       * The distance term used to be `lyOrLast(distance) * 500`, which made every unknown seller
       * score Infinity. Since `Infinity < Infinity` is false, the first unknown seller in the
       * list won whenever no measured one sold the material — whatever it charged.
       */
      const known = isKnownLy(st.distanceLy);
      const score = (hasAllPrices ? cost : cost + 9_999_999) + (known ? st.distanceLy! * 500 : 0);
      const better =
        bestKey == null ||
        (known && !bestKnown) ||
        (known === bestKnown &&
          (score < bestScore || (score === bestScore && covers.length > bestCover.length)));
      if (better) {
        bestKey = sKey;
        bestCover = covers;
        bestScore = score;
        bestKnown = known;
      }
    }

    if (!bestKey || bestCover.length === 0) break;
    const st = stationByKey.get(bestKey)!;
    for (const c of bestCover) remaining.delete(c.id);
    groups.push(groupFromStop(st, bestCover, groups.length));
  }
  return groups;
}

export function routeStations(
  mode: CheckoutRoutingMode,
  stationByKey: Map<string, Unified>,
  need: NeedRow[],
  filters: CheckoutFilters,
): CheckoutStationGroup[] {
  if (mode === "nearest") return routeNearest(stationByKey, need, filters);
  if (mode === "cheapest") return routeCheapest(stationByKey, need, filters);
  return greedyFewestStops(stationByKey, need, filters);
}
