import { parseCarrierHaul } from "../../../shared/colonize/carrierStock";
import { parseMinLandingPad } from "../../../shared/colonize/stationFilter";
import type { CheckoutRoutingMode } from "../../../shared/colonize/types";
import type { CheckoutFilterState } from "../lib/planFilters";
import { STORAGE_KEYS, clearRetiredKeys, readJson, readRaw } from "./persisted";

/**
 * The window's own UI state: what the commander has chosen, as opposed to what the
 * journal reports.
 *
 * A single reducer means every transition is named and visible, and persistence happens in exactly one place
 * (AppStateContext.tsx). EDEXO-Colonize's app mode, basket, auto-basket switch, per-depot view and shopping run were
 * slices here too; 1.3.0 shows none of them (the plan replaced them), so they went (audit 2026-10-22).
 */
export type UiState = {
  checkoutFilters: CheckoutFilterState;
  routingMode: CheckoutRoutingMode;
  /**
   * Pinned shopping hub per construction site, keyed by market id.
   *
   * This used to be one storage key per depot, read straight from `localStorage` at call
   * time, with a counter in React state bumped by hand to force anything depending on it
   * to recompute. Holding it as real state removes both the side channel and the counter.
   */
  depotRefPins: Record<string, string>;
  /**
   * Carriers the commander has switched on, by `CarrierID`.
   *
   * Off is the default and the answer to "is this carrier hauling to the build". A carrier that
   * is on contributes its stock to what the planner treats as already owned; a carrier that is
   * off changes nothing and shows nothing. Only ids that are on are stored.
   */
  carrierHaul: Record<string, boolean>;
};

export type UiAction =
  | { type: "setCheckoutFilters"; filters: CheckoutFilterState }
  | { type: "setRoutingMode"; mode: CheckoutRoutingMode }
  | { type: "setDepotRefPin"; marketId: string; system: string }
  | { type: "toggleCarrierHaul"; carrierId: string };

const DEFAULT_CHECKOUT_FILTERS: CheckoutFilterState = {
  includePlanetaryAndGround: true,
  showPlanetary: true,
  maxDistanceLy: "",
  minSupply: "",
  minLandingPad: "any",
  stationKind: "any",
  largePadOnly: false,
  excludeFleetCarriers: false,
};

function parseCheckoutFilters(raw: unknown): CheckoutFilterState | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Partial<CheckoutFilterState>;
  const minLandingPad = parseMinLandingPad(j.minLandingPad);
  const showPlanetary = typeof j.showPlanetary === "boolean" ? j.showPlanetary : true;
  return {
    includePlanetaryAndGround: showPlanetary,
    showPlanetary,
    maxDistanceLy: typeof j.maxDistanceLy === "string" ? j.maxDistanceLy : "",
    minSupply: typeof j.minSupply === "string" ? j.minSupply : "",
    minLandingPad,
    stationKind: showPlanetary ? "any" : "space",
    largePadOnly: minLandingPad === "L",
    excludeFleetCarriers: j.excludeFleetCarriers === true,
  };
}

function parseDepotRefPins(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

function readRoutingMode(): CheckoutRoutingMode {
  const stored = readRaw(STORAGE_KEYS.checkoutRouting);
  return stored === "nearest" || stored === "cheapest" || stored === "fewest_stops"
    ? stored
    : "fewest_stops";
}

export function initialUiState(): UiState {
  clearRetiredKeys();
  return {
    checkoutFilters: readJson(
      STORAGE_KEYS.checkoutFilters,
      parseCheckoutFilters,
      DEFAULT_CHECKOUT_FILTERS,
    ),
    routingMode: readRoutingMode(),
    depotRefPins: readJson(STORAGE_KEYS.depotRefPins, parseDepotRefPins, {}),
    carrierHaul: readJson(STORAGE_KEYS.carrierHaul, parseCarrierHaul, {}),
  };
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "setCheckoutFilters":
      return { ...state, checkoutFilters: action.filters };

    case "setRoutingMode":
      return { ...state, routingMode: action.mode };

    case "setDepotRefPin": {
      const system = action.system.trim();
      const next = { ...state.depotRefPins };
      if (system) next[action.marketId] = system;
      else delete next[action.marketId];
      return { ...state, depotRefPins: next };
    }

    case "toggleCarrierHaul": {
      const next = { ...state.carrierHaul };
      /** Off is the default, so switching one off removes it rather than storing a false. */
      if (next[action.carrierId]) delete next[action.carrierId];
      else next[action.carrierId] = true;
      return { ...state, carrierHaul: next };
    }

    default:
      return state;
  }
}

/** The pinned hub for a site, falling back to the system the journal reported. */
export function depotReferenceSystemFrom(
  pins: Record<string, string>,
  depot: { marketId: string; starSystem?: string | null },
): string {
  return pins[depot.marketId]?.trim() || depot.starSystem?.trim() || "";
}
