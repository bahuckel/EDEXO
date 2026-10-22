import type { DepotSnapshot } from "../types";
import { hasBoughtFromStation, isRecentShopStation, type ShopHistoryEntry } from "../shopHistory";
import { isKnownLy } from "../systemDistanceLy";
import { isStationBanned, type BannedStation } from "../stationBans";
import {
  allowSurfaceStation,
  matchesDockedStation,
  normSystemName,
  stationMeetsKindFilter,
  type DockedStationRef,
  type StationKindFilter,
} from "../stationFilter";
import {
  buyStopLy,
  countCompletableAtStation,
  hasPrimaryNeedAtStation,
  stationEligible,
  stationFillPlan,
  stationInHistory,
  stationLy,
} from "./stationFacts";
import { legLy, measuredLegLy, type LegEnd, type SystemCoordsByNorm } from "./legLy";
import type { PickBuyStationArgs, PlannerStation, TripStop } from "./types";

/** Pick the next stop and put a trip's stops in a sensible order. */

/**
 * Closest primary target first; sweep committed systems for opportunistic stacks before leaving.
 */
export function pickNextBuyStation(args: PickBuyStationArgs): PlannerStation | null {
  let best: PlannerStation | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const st of args.catalog.values()) {
    if (
      !stationEligible(
        st,
        args.proof,
        args.needs,
        args.freeTons,
        args.visited,
        args.activeDepots,
        args.constructionSystems,
        args.includeAllPlanetaryAndGround,
        args.history,
        args.bannedStations,
        args.dockedStation,
        args.largePadOnly,
        args.maxDistanceLy,
        args.buyPreference,
        args.routeCtx,
        args.minLandingPad,
        args.stationKind,
        args.excludeFleetCarriers,
      )
    ) {
      continue;
    }

    const { fill: packTons, lines } = stationFillPlan(st, args.proof, args.needs, args.freeTons, args.routeCtx);
    if (packTons <= 0) continue;

    const isPrimary = hasPrimaryNeedAtStation(st, args.needs, args.routeCtx.primaryPreferred, args.routeCtx.exhausted);
    const sys = normSystemName(st.systemName);
    const isOpportunisticSweep = !isPrimary && args.routeCtx.committedSystems.has(sys);

    const completable = countCompletableAtStation(st, args.proof, args.needs, args.freeTons, args.routeCtx);
    const ly = stationLy(st, args.buyPreference);
    const dockedHere = matchesDockedStation(st, args.dockedStation);
    const hop =
      args.lastStopLy == null || args.lastStopSystem == null
        ? ly
        : legLy({ systemName: args.lastStopSystem, ly: args.lastStopLy }, { systemName: st.systemName, ly }, args.systemCoords);

    /*
      The fewest trips, from the biggest batches (owner, 2026-10-22): a station that fills the hold wins, and of those
      the one that does it with the fewest commodities (each extra line costs as much as 40 t of fill). Distance and a
      finished material break ties. It used to be finished materials first (5e8 each), which sent an 80 t hold to a
      colony market with 5 t of 16 things, 80 trips running.
    */
    let score = packTons * 1_000_000 - lines * 40_000_000 + completable * 1_000_000;
    if (dockedHere && args.lastStopLy == null) score += 2_000_000_000;
    if (isOpportunisticSweep) {
      score += 400_000_000;
      score -= hop * 200_000;
    } else if (isPrimary) {
      score -= ly * 200_000;
      score -= hop * 50_000;
    }
    /**
     * Familiarity is a preference between comparable stations, not a trump card.
     *
     * These used to be flat +5e10 and +2e10, which dwarfed both the completable-SKU term
     * (5e8 each) and the distance penalty (2e4 per Ly). The result was that a station
     * visited once, 800 Ly away, beat an unvisited one 5 Ly away that finished ten more
     * materials — and beat the station the commander was currently docked at. The bonus
     * now decays with distance, so it breaks ties nearby and is worth almost nothing far
     * out, including when the distance is unknown.
     */
    const familiarity = hasBoughtFromStation(args.history, st.systemName, st.stationName)
      ? 30_000_000
      : isRecentShopStation(args.history, st.systemName, st.stationName)
        ? 12_000_000
        : 0;
    if (familiarity > 0) score += familiarity / (1 + Math.max(0, ly) / 25);

    if (score > bestScore) {
      best = st;
      bestScore = score;
    }
  }

  return best;
}

/**
 * The loop flown for a trip's buys: from the site to the first seller, seller to seller, and back.
 *
 * This used to add up each seller's distance from the site, which is the length of no route at
 * all — one seller 10 Ly out read as 10, two sellers side by side 30 Ly out as 60. A leg whose
 * length is unknown is left out, so the figure is a floor.
 */
export function sumBuyRouteLy(stops: TripStop[], coords?: SystemCoordsByNorm): number {
  const buys = stops.filter((s) => s.kind === "buy");
  if (!buys.length) return 0;
  const siteLy = (s: TripStop) => s.constructionDistanceLy ?? s.distanceLy;
  let sum = 0;
  const first = siteLy(buys[0]!);
  const last = siteLy(buys[buys.length - 1]!);
  if (isKnownLy(first)) sum += first;
  if (isKnownLy(last)) sum += last;
  for (let i = 1; i < buys.length; i++) {
    const a = buys[i - 1]!;
    const b = buys[i]!;
    const measured = measuredLegLy(a.systemName, b.systemName, coords);
    if (measured != null) {
      sum += measured;
      continue;
    }
    const la = siteLy(a);
    const lb = siteLy(b);
    if (isKnownLy(la) && isKnownLy(lb)) sum += Math.abs(lb - la);
  }
  return sum;
}

export function pruneSurfaceStations(
  catalog: Map<string, PlannerStation>,
  constructionSystems: string[],
  includeAllPlanetaryAndGround: boolean,
  history: ShopHistoryEntry[],
  bannedStations: BannedStation[],
  dockedStation?: DockedStationRef | null,
  stationKind?: StationKindFilter,
): void {
  for (const [key, st] of catalog) {
    if (isStationBanned(bannedStations, st.systemName, st.stationName)) {
      catalog.delete(key);
      continue;
    }
    if (matchesDockedStation(st, dockedStation)) continue;
    if (!stationMeetsKindFilter(st.isPlanetaryOrGround, stationKind)) {
      catalog.delete(key);
      continue;
    }
    if (stationKind === "space" || stationKind === "ground") continue;
    if (stationInHistory(history, st)) continue;
    if (
      !allowSurfaceStation({
        isPlanetaryOrGround: st.isPlanetaryOrGround,
        distanceLy: st.distanceLy,
        systemName: st.systemName,
        constructionSystems,
        includeAllPlanetaryAndGround,
      })
    ) {
      catalog.delete(key);
    }
  }
}

export function primaryDeliverSystem(depots: DepotSnapshot[]): string {
  const sys = depots.map((d) => d.starSystem?.trim()).filter(Boolean) as string[];
  return sys[0] ?? "Construction";
}

/** Nearest-neighbor route: start at closest station to construction, then shortest hop each leg. */
export function orderBuyStopsForTrip(stops: TripStop[], coords?: SystemCoordsByNorm): TripStop[] {
  const buys = stops.filter((s) => s.kind === "buy");
  const delivers = stops.filter((s) => s.kind === "deliver");
  if (buys.length <= 1) return stops;

  const ordered: TripStop[] = [];
  const rem = [...buys];
  let last: LegEnd | null = null;

  while (rem.length) {
    let pick = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < rem.length; i++) {
      const stop = rem[i]!;
      const ly = buyStopLy(stop);
      let score = -ly;
      if (last) {
        score -= legLy(last, { systemName: stop.systemName, ly }, coords) * 10_000;
        if (normSystemName(stop.systemName) === normSystemName(last.systemName)) score += 50_000;
      }
      if (score > bestScore) {
        bestScore = score;
        pick = i;
      }
    }
    const next = rem.splice(pick, 1)[0]!;
    ordered.push(next);
    last = { systemName: next.systemName, ly: buyStopLy(next) };
  }

  return [
    ...ordered.map((s, i) => ({ ...s, stopIndex: i })),
    ...delivers.map((s, i) => ({ ...s, stopIndex: ordered.length + i })),
  ];
}
