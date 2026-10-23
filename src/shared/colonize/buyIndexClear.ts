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

/** How long after a site finished its nearby sellers stay (discuss item 6, owner 2026-10-23). */
export const FINISHED_SITE_SELLERS_DAYS = 30;

/**
 * The seller buckets that belong only to sites finished (built or failed) more than 30 days ago. A bucket is keyed by
 * the site's hub pin, else its system (normalised as the index does); any bucket an unfinished site still uses stays.
 */
export function finishedSellerRefs(
  depots: { marketId: string; starSystem: string | null; complete: boolean; failed: boolean; progress: number | null; lastTimestamp: string | null }[],
  pins: Record<string, string>,
  normRef: (name: string) => string,
  nowMs = Date.now(),
): Set<string> {
  const refOf = (d: (typeof depots)[number]) => normRef(pins[d.marketId] ?? d.starSystem ?? "");
  const finished = (d: (typeof depots)[number]) => d.complete || d.failed || (d.progress != null && d.progress >= 1);
  const keep = new Set<string>();
  const old = new Set<string>();
  for (const d of depots) {
    const ref = refOf(d);
    if (!ref) continue;
    if (!finished(d)) {
      keep.add(ref);
      continue;
    }
    const t = Date.parse(d.lastTimestamp ?? "");
    if (Number.isFinite(t) && nowMs - t > FINISHED_SITE_SELLERS_DAYS * 86_400_000) old.add(ref);
    else keep.add(ref);
  }
  for (const r of keep) old.delete(r);
  return old;
}

/**
 * Drops the found sellers (Spansh, Inara, EDSM) of the given buckets; the commander's journal sellers and stations
 * where he bought stay. A row left with no seller goes; the scan time of a kept row is not touched.
 */
export function pruneBuyIndexRefs(
  systems: MaterialBuyIndexFile["systems"],
  refs: ReadonlySet<string>,
): { systems: MaterialBuyIndexFile["systems"]; removedHits: number } {
  if (!refs.size) return { systems, removedHits: 0 };
  const next: MaterialBuyIndexFile["systems"] = {};
  let removedHits = 0;
  for (const [ref, rows] of Object.entries(systems)) {
    if (!refs.has(ref)) {
      next[ref] = rows;
      continue;
    }
    const keptRows: Record<string, MaterialBuyIndexRow> = {};
    for (const [id, row] of Object.entries(rows)) {
      const stations = row.stations.filter((h) => h.dataSource === "journal" || h.purchaseProven);
      removedHits += row.stations.length - stations.length;
      if (stations.length) keptRows[id] = stations.length === row.stations.length ? row : { ...row, stations };
    }
    if (Object.keys(keptRows).length) next[ref] = keptRows;
  }
  return { systems: next, removedHits };
}
