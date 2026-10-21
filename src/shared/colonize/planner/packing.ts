import { recordTripAllocation } from "./needs";
import { canPackCommodityAtStation } from "./stationFacts";
import { stationSellsCommodity } from "./stationKeys";
import type {
  ListingProof,
  PackAllocCtx,
  PackLine,
  PackRouteContext,
  PlannerNeed,
  PlannerStation,
} from "./types";

/** Choose what to buy at a station, given what is still needed and what the hold can take. */

export function packAtStation(
  station: PlannerStation,
  proof: ListingProof,
  needs: Map<string, PlannerNeed>,
  maxTons: number,
  alloc?: PackAllocCtx,
  routeCtx?: PackRouteContext,
): PackLine[] {
  if (maxTons <= 0) return [];
  const candidates: { id: string; score: number; line: PackLine }[] = [];
  for (const [id, need] of needs) {
    if (need.tons <= 0) continue;
    if (routeCtx && !canPackCommodityAtStation(id, station, routeCtx)) continue;
    if (!stationSellsCommodity(proof, station.key, id)) continue;
    const offer = station.offers.get(id);
    if (!offer || offer.supply <= 0) continue;
    const buy = Math.min(need.tons, offer.supply, maxTons);
    if (buy <= 0) continue;
    const completes = buy >= need.tons - 0.01;
    const score = (completes ? 1_000_000_000 : 0) + buy + need.tons * 0.001;
    candidates.push({
      id,
      score,
      line: {
        commodityId: id,
        label: need.label,
        buyTons: buy,
        buyPrice: offer.buyPrice,
        forDepots: [...need.forDepots],
      },
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  const lines: PackLine[] = [];
  let used = 0;
  for (const c of candidates) {
    if (used >= maxTons) break;
    const need = needs.get(c.id);
    if (!need || need.tons <= 0) continue;
    const offer = station.offers.get(c.id)!;
    const buy = Math.min(need.tons, offer.supply, maxTons - used);
    if (buy <= 0) continue;
    const line: PackLine = { ...c.line, buyTons: buy };
    need.tons -= buy;
    used += buy;
    if (alloc) {
      const allocatedTo = recordTripAllocation(
        alloc.tripAllocation,
        alloc.depotStates,
        c.id,
        c.line.label,
        buy,
      );
      /** Name only the sites this purchase is actually destined for. */
      if (allocatedTo.length) line.forDepots = allocatedTo;
    }
    lines.push(line);
  }
  return lines;
}
