/**
 * What the haul plan may use: pad, planet ports, carriers that sell, distance. In EDEXO-Colonize these were the
 * checkout dialog's filters, reachable only from the Build tab's basket; in EDEXO (1.3.0) they sit on the plan.
 */
import type { MinLandingPad, StationKindFilter } from "../../../shared/colonize/stationFilter";

export type CheckoutFilterState = {
  includePlanetaryAndGround: boolean;
  /** Include surface ports / surface stations. */
  showPlanetary: boolean;
  maxDistanceLy: string;
  minSupply: string;
  /** Kept in sync with minLandingPad === "L" for Inara links and older callers. */
  largePadOnly: boolean;
  minLandingPad: MinLandingPad;
  stationKind: StationKindFilter;
  excludeFleetCarriers: boolean;
};
