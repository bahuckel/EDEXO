import type { MaterialBuyIndexFile, MaterialBuyIndexRow } from "./materialBuyIndexTypes";
import type { CheckoutOfferSource } from "./types";

export type ClearBuyDataScope = "all" | "spansh" | "visited" | "inara";

/** Drop index rows whose dataSource is in `sources`. Optionally delete whole ref buckets (e.g. "inara"). */
export function pruneBuyIndexBySources(
  systems: MaterialBuyIndexFile["systems"],
  sources: ReadonlySet<CheckoutOfferSource>,
  dropRefKeys: string[] = [],
): { systems: MaterialBuyIndexFile["systems"]; removedHits: number } {
  const dropRefs = new Set(dropRefKeys.map((k) => k.trim().toLowerCase()).filter(Boolean));
  const next: MaterialBuyIndexFile["systems"] = {};
  let removedHits = 0;

  for (const [ref, rows] of Object.entries(systems)) {
    if (dropRefs.has(ref.trim().toLowerCase())) {
      for (const row of Object.values(rows)) removedHits += row.stations.length;
      continue;
    }
    const keptRows: Record<string, MaterialBuyIndexRow> = {};
    for (const [id, row] of Object.entries(rows)) {
      const stations = row.stations.filter((h) => !sources.has(h.dataSource));
      removedHits += row.stations.length - stations.length;
      if (!stations.length) continue;
      // Removing hits is not a scan: the row keeps its scan time, so the next background look is not put off 14 days.
      keptRows[id] = stations.length === row.stations.length ? row : { ...row, stations };
    }
    if (Object.keys(keptRows).length) next[ref] = keptRows;
  }

  return { systems: next, removedHits };
}
