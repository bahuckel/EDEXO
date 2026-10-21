import { resourceNeedId } from "./commodityKey";
import type { ResourceRow } from "./types";

/** Extra build % if you deliver matching cargo on your ship (payment-weighted). */
export function cargoDeliveryProgressBoost(resources: ResourceRow[], cargoByKey: Map<string, number>): number {
  if (!resources.length || !cargoByKey.size) return 0;

  let totalValue = 0;
  let cargoValue = 0;

  for (const r of resources) {
    if (r.required <= 0) continue;
    const payment = r.payment ?? 0;
    totalValue += Math.max(0, payment);

    const gap = Math.max(0, r.required - r.provided);
    if (gap <= 0) continue;

    const bucket = resourceNeedId(r);
    const onHand = bucket ? (cargoByKey.get(bucket) ?? 0) : 0;
    const deliverable = Math.min(onHand, gap);
    if (deliverable > 0) {
      cargoValue += deliverable * (payment / r.required);
    }
  }

  if (totalValue <= 0) {
    let totalTons = 0;
    let cargoTons = 0;
    for (const r of resources) {
      if (r.required <= 0) continue;
      totalTons += r.required;
      const gap = Math.max(0, r.required - r.provided);
      if (gap <= 0) continue;
      const bucket = resourceNeedId(r);
      const onHand = bucket ? (cargoByKey.get(bucket) ?? 0) : 0;
      cargoTons += Math.min(onHand, gap);
    }
    if (totalTons <= 0) return 0;
    return Math.min(1, cargoTons / totalTons);
  }

  return Math.min(1, cargoValue / totalValue);
}
