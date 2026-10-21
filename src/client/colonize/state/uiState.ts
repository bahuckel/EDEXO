import { parseMinLandingPad } from "../../../shared/colonize/stationFilter";
import { parseShoppingRun } from "../../../shared/colonize/storageValidation";
import type { CheckoutRoutingMode } from "../../../shared/colonize/types";
import type { CheckoutFilterState } from "../lib/planFilters";
import type { ShoppingRunState } from "../../../shared/colonize/types";
import type { BasketLine } from "../lib/shared";
import {
  LEGACY_KEYS,
  STORAGE_KEYS,
  clearLegacyDepotRefPins,
  readJson,
  readLegacyDepotRefPins,
  readRaw,
} from "./persisted";

export type AppMode = "build" | "plan" | "search";

/**
 * The renderer's own UI state: what the commander has chosen, as opposed to what the
 * journal reports.
 *
 * Previously this was seven `useState` calls in App with their own loaders, and each was
 * written back to storage at whichever call site happened to change it — the basket from
 * five places, the shopping run from five more. A single reducer means every transition
 * is named and visible, and persistence happens in exactly one place.
 */
export type UiState = {
  appMode: AppMode;
  basket: BasketLine[];
  autoBasketSync: boolean;
  checkoutFilters: CheckoutFilterState;
  routingMode: CheckoutRoutingMode;
  perDepotMode: boolean;
  shoppingRun: ShoppingRunState | null;
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
  | { type: "setAppMode"; mode: AppMode }
  | { type: "setBasket"; lines: BasketLine[] }
  | { type: "addBasketLine"; line: BasketLine }
  | { type: "removeBasketLine"; id: string }
  | { type: "clearBasket" }
  | { type: "setAutoBasketSync"; enabled: boolean }
  | { type: "setCheckoutFilters"; filters: CheckoutFilterState }
  | { type: "setRoutingMode"; mode: CheckoutRoutingMode }
  | { type: "setPerDepotMode"; enabled: boolean }
  | { type: "setShoppingRun"; run: ShoppingRunState | null }
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

function parseBasket(raw: unknown): BasketLine[] | null {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(
      (x): x is BasketLine =>
        Boolean(x && typeof x === "object") &&
        typeof (x as BasketLine).id === "string" &&
        typeof (x as BasketLine).name === "string" &&
        typeof (x as BasketLine).nameLocalised === "string",
    )
    .map((x) => ({
      ...x,
      quantityTons: typeof x.quantityTons === "number" && x.quantityTons > 0 ? x.quantityTons : 1,
    }));
}

function parseCheckoutFilters(raw: unknown): CheckoutFilterState | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Partial<CheckoutFilterState> & { largePadOnly?: boolean };
  const minLandingPad = parseMinLandingPad(j.minLandingPad, j.largePadOnly === true);
  /** Older builds stored `stationKind` instead of this flag; derive it when absent. */
  const showPlanetary =
    typeof j.showPlanetary === "boolean" ? j.showPlanetary : j.stationKind !== "space";
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

function parseCarrierHaul(raw: unknown): Record<string, boolean> | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true && k.trim()) out[k.trim()] = true;
  }
  return out;
}

function readAppMode(): AppMode {
  const stored = readRaw(STORAGE_KEYS.appMode);
  if (stored === "plan" || stored === "search" || stored === "build") return stored;
  /** "supply" was the colony-advisor tab, which no longer exists. */
  if (stored === "supply") return "search";
  /**
   * Plan first. The app exists to answer "what do I buy and where", which is the Plan tab; Build
   * opened first only because it was written first, and a commander who wanted the buying list
   * paid a click for it every launch. A stored choice still wins — this is only the default.
   */
  return "plan";
}

function readRoutingMode(): CheckoutRoutingMode {
  const stored = readRaw(STORAGE_KEYS.checkoutRouting);
  return stored === "nearest" || stored === "cheapest" || stored === "fewest_stops"
    ? stored
    : "fewest_stops";
}

function readBasket(): BasketLine[] {
  const current = readJson(STORAGE_KEYS.basket, parseBasket, []);
  if (current.length) return current;
  return readJson(LEGACY_KEYS.basketV1, parseBasket, []);
}

function readDepotRefPins(): Record<string, string> {
  const current = readJson(STORAGE_KEYS.depotRefPins, parseDepotRefPins, {});
  if (Object.keys(current).length) return current;
  /** Fold the one-key-per-depot layout an earlier build used into the single record. */
  const legacy = readLegacyDepotRefPins();
  if (Object.keys(legacy).length) clearLegacyDepotRefPins();
  return legacy;
}

export function initialUiState(): UiState {
  return {
    appMode: readAppMode(),
    basket: readBasket(),
    autoBasketSync: readRaw(STORAGE_KEYS.autoBasketSync) === "1",
    checkoutFilters: readJson(
      STORAGE_KEYS.checkoutFilters,
      parseCheckoutFilters,
      DEFAULT_CHECKOUT_FILTERS,
    ),
    routingMode: readRoutingMode(),
    /** Deliberately not persisted: a per-session view choice, not a preference. */
    perDepotMode: false,
    shoppingRun: readJson(STORAGE_KEYS.shoppingRun, (raw) => parseShoppingRun(raw), null),
    depotRefPins: readDepotRefPins(),
    carrierHaul: readJson(STORAGE_KEYS.carrierHaul, parseCarrierHaul, {}),
  };
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "setAppMode":
      return state.appMode === action.mode ? state : { ...state, appMode: action.mode };

    case "setBasket":
      return { ...state, basket: action.lines };

    case "addBasketLine": {
      const existing = state.basket.find((x) => x.id === action.line.id);
      /** Adding a line already in the basket raises its quantity rather than duplicating it. */
      const basket = existing
        ? state.basket.map((x) =>
            x.id === action.line.id
              ? { ...x, quantityTons: Math.max(x.quantityTons, action.line.quantityTons) }
              : x,
          )
        : [...state.basket, action.line];
      return { ...state, basket };
    }

    case "removeBasketLine":
      return { ...state, basket: state.basket.filter((x) => x.id !== action.id) };

    case "clearBasket":
      return state.basket.length === 0 ? state : { ...state, basket: [] };

    case "setAutoBasketSync":
      return { ...state, autoBasketSync: action.enabled };

    case "setCheckoutFilters":
      return { ...state, checkoutFilters: action.filters };

    case "setRoutingMode":
      return { ...state, routingMode: action.mode };

    case "setPerDepotMode":
      return { ...state, perDepotMode: action.enabled };

    case "setShoppingRun":
      return { ...state, shoppingRun: action.run };

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
