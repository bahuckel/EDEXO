import { resourceNeedId } from "./commodityKey";
import type { ContributionRecord, ResourceRow } from "./types";

/** Share of total build value from your cumulative deliveries (payment-weighted like the game). */
export function personalContributionProgress(
  contributions: ContributionRecord[],
  resources: ResourceRow[],
): number {
  if (!contributions.length || !resources.length) return 0;

  const lineByBucket = new Map<string, { required: number; payment: number }>();
  let totalValue = 0;
  for (const r of resources) {
    if (r.required <= 0) continue;
    const bucket = resourceNeedId(r);
    const payment = r.payment ?? 0;
    if (bucket) lineByBucket.set(bucket, { required: r.required, payment });
    totalValue += Math.max(0, payment);
  }

  if (totalValue <= 0) {
    let totalTons = 0;
    for (const r of resources) {
      if (r.required > 0) totalTons += r.required;
    }
    if (totalTons <= 0) return 0;
    const userTons = contributions.reduce((sum, c) => sum + c.totalTons, 0);
    return Math.min(1, userTons / totalTons);
  }

  let userValue = 0;
  for (const c of contributions) {
    const line = lineByBucket.get(c.commodityId);
    if (!line || line.required <= 0) continue;
    userValue += c.totalTons * (line.payment / line.required);
  }
  return Math.min(1, userValue / totalValue);
}
