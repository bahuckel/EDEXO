/**
 * Public face of the planner.
 *
 * The implementation lives in `./planner/`, split by stage: what each site needs, which
 * stations are worth considering, what is true about one station, what to buy there, how
 * to order the stops, and the orchestrator that drives them. This file exists so the rest
 * of the app keeps one import path and does not depend on that internal shape.
 */
export type {
  HaulTrip,
  LogisticsPlan,
  MaterialBuyStationFilter,
  MissingBuyIndexedItem,
  PlannerNeed,
  PlannerStation,
  TripBuyLine,
  TripDeliverDepot,
  TripDeliverMaterial,
  TripStop,
} from "./planner/types";

export { buildLogisticsPlan } from "./planner/buildPlan";
