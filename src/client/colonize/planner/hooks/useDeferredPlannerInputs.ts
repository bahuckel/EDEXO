import { useDeferredValue, useMemo } from "react";
import type { MaterialBuyListing } from "../../../../shared/colonize/materialBuyIndexTypes";
import type { ShopHistoryEntry } from "../../../../shared/colonize/shopHistory";
import type { BasketCheckoutResult } from "../../../../shared/colonize/types";

/** Everything the plan and the buy cards are derived from — the values that make rebuilding costly. */
export type PlannerInputs = {
  checkouts: BasketCheckoutResult[];
  buyListings: MaterialBuyListing[];
  cargoByKey: Map<string, number>;
  shopHistory: ShopHistoryEntry[];
  systemDistanceLy: Record<string, number>;
};

/**
 * The panel's one staleness boundary.
 *
 * Deferring each input on its own, and then the plan built from them again, let three generations
 * of the same data sit on screen at once: the badges counted fresh stations while the trips below
 * them still described the previous ones. Bundling the inputs and deferring that bundle once means
 * every derived view — badges, buy cards, trips — is built from the same generation, so the screen
 * is either fully current or uniformly one step behind while React works on the update.
 */
export function useDeferredPlannerInputs(inputs: PlannerInputs): PlannerInputs {
  const { checkouts, buyListings, cargoByKey, shopHistory, systemDistanceLy } = inputs;
  const bundle = useMemo(
    () => ({ checkouts, buyListings, cargoByKey, shopHistory, systemDistanceLy }),
    [checkouts, buyListings, cargoByKey, shopHistory, systemDistanceLy],
  );
  return useDeferredValue(bundle);
}
