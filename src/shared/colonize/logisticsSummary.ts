import { resourceNeedId } from "./commodityKey";
import { getResourceTradeCategory } from "./commodityCategories";
import type { DepotSnapshot } from "./types";
import { makeCargoPool, tonsStillNeededWithPool } from "./basketGap";

export type LogisticsSkuRow = {
  id: string;
  label: string;
  category: string;
  totalTonsNeeded: number;
  depotCount: number;
  depotLabels: string[];
};

export type LogisticsSummary = {
  totalTonsOutstanding: number;
  skuCount: number;
  rows: LogisticsSkuRow[];
};

function depotLabel(d: DepotSnapshot): string {
  return d.constructionSiteLabel || d.stationName || `Market ${d.marketId}`;
}

export function buildLogisticsSummary(
  depots: DepotSnapshot[],
  cargoByKey: Map<string, number>,
): LogisticsSummary {
  const acc = new Map<
    string,
    { label: string; category: string; totalTonsNeeded: number; depots: Set<string> }
  >();

  /**
   * One pool across every depot: a ton in the hold can only be delivered once, so
   * allocating it per row let the same cargo cancel out the same need at every depot
   * that wanted it, and this summary reported less outstanding than the planner did.
   */
  const cargoPool = makeCargoPool(cargoByKey);

  for (const d of depots) {
    const label = depotLabel(d);
    for (const r of d.resources) {
      const need = tonsStillNeededWithPool(r, cargoPool);
      if (need <= 0) continue;
      const id = resourceNeedId(r);
      if (!id) continue;
      const rowLabel = (r.nameLocalised || r.name).trim() || r.name;
      let cur = acc.get(id);
      if (!cur) {
        cur = {
          label: rowLabel,
          category: getResourceTradeCategory(r),
          totalTonsNeeded: 0,
          depots: new Set(),
        };
        acc.set(id, cur);
      }
      cur.totalTonsNeeded += need;
      cur.depots.add(label);
    }
  }

  const rows: LogisticsSkuRow[] = [...acc.entries()]
    .map(([id, v]) => ({
      id,
      label: v.label,
      category: v.category,
      totalTonsNeeded: v.totalTonsNeeded,
      depotCount: v.depots.size,
      depotLabels: [...v.depots].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.totalTonsNeeded - a.totalTonsNeeded || a.label.localeCompare(b.label));

  const totalTonsOutstanding = rows.reduce((s, r) => s + r.totalTonsNeeded, 0);

  return { totalTonsOutstanding, skuCount: rows.length, rows };
}
