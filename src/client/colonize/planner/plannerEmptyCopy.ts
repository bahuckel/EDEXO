import { SURFACE_STATION_MAX_LY, type MinLandingPad, type StationKindFilter } from "../../../shared/colonize/stationFilter";

/**
 * What the planner says when it has nothing to show, derived from what is actually set.
 *
 * Both lines used to be hard-coded. The app told commanders "Scanning Spansh from your
 * construction systems…" whether or not Spansh was switched on — so with live scans off, the
 * panel sat there claiming a scan was running that never would. The other line promised "large
 * pads only (Coriolis, Ocellus, Orbis)" regardless of the pad and station-kind filters, which
 * was wrong for anyone flying something smaller than a Python.
 */

export type PlannerFilterState = {
  minLandingPad: MinLandingPad | undefined;
  largePadOnly: boolean;
  stationKind: StationKindFilter;
  excludeFleetCarriers: boolean;
  includeAllPlanetaryAndGround: boolean;
  maxDistanceLy: number | null;
};

export type PlannerScanState = {
  liveSpanshScans: boolean;
  scanBusy: boolean;
  /** A manual Spansh scan is available even when the background one is off. */
  canScanManually: boolean;
};

function padText(f: PlannerFilterState): string {
  const min = f.minLandingPad ?? (f.largePadOnly ? "L" : "any");
  if (min === "L") return "Buy stops need a large pad";
  if (min === "M") return "Buy stops need a medium pad or better";
  return "Buy stops can be any pad";
}

function kindText(f: PlannerFilterState): string | null {
  if (f.stationKind === "space") return "orbital markets only";
  if (f.stationKind === "ground") return "surface markets only";
  if (f.includeAllPlanetaryAndGround) return "surface markets included at any range";
  return `surface markets only within ${SURFACE_STATION_MAX_LY} Ly`;
}

/** The line under a plan: what the trips were allowed to use. */
export function plannerPolicyText(f: PlannerFilterState): string {
  const bits = [padText(f)];
  const kind = kindText(f);
  if (kind) bits.push(kind);
  if (f.excludeFleetCarriers) bits.push("no fleet carriers");
  if (f.maxDistanceLy != null && f.maxDistanceLy > 0) bits.push(`within ${f.maxDistanceLy} Ly of the build`);
  return (
    `Each trip fills your hold to capacity, delivers to construction, then repeats. ${bits.join(", ")}, ` +
    "ordered nearest-first. Distances are Ly from the build site."
  );
}

/** The line when there is no plan at all, which depends on whether anything is actually looking. */
export function plannerNoPlanText(s: PlannerScanState): string {
  const tail = "Distances are Ly from build site to seller. Priority: bought here → visited → orbital → closer.";
  if (s.scanBusy) return `Scanning Spansh from your construction systems… ${tail}`;
  if (s.liveSpanshScans) return `Looking for sellers near your construction systems… ${tail}`;
  if (s.canScanManually) {
    return (
      "No saved sellers yet, and background Spansh scans are off. Use Scan Spansh above, or dock at a " +
      `market to add it from your journal. ${tail}`
    );
  }
  return `No saved sellers yet. Dock at a market and it is added from your journal. ${tail}`;
}
