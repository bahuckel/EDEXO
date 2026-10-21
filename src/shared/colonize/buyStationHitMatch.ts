import { commodityIdsEquivalent, commodityNeedMatchesLabel } from "./commodityKey";
import type { MaterialBuyStationHit } from "./materialBuyIndexTypes";

/** True when a saved index / listing hit actually sells this depot SKU. */
export function buyStationHitMatchesNeed(
  needId: string,
  needLabel: string,
  hit: Pick<MaterialBuyStationHit, "spanshCommodity" | "purchaseProven">,
): boolean {
  const sp = hit.spanshCommodity?.trim();
  if (!sp) return false;
  if (needId && (sp === needId || commodityIdsEquivalent(sp, needId))) return true;
  return commodityNeedMatchesLabel(needId, needLabel, sp);
}
