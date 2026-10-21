import type { ColonizeSnapshot } from "../../../shared/colonize/types";

/**
 * Carry unchanged parts of a snapshot forward by reference.
 *
 * The snapshot crosses IPC, which structurally clones it, so every push hands the renderer
 * brand-new arrays even for the parts that did not change. Cargo changes constantly while
 * trading, and each of those pushes used to give `activeDepots` a fresh identity — which is
 * enough to make every memo keyed on it recompute, including the whole logistics plan.
 *
 * Comparing a cheap per-slice signature and reusing the previous array when it matches means
 * a memo only re-runs when its own input actually changed. Nothing here mutates the incoming
 * snapshot; it returns one assembled from both.
 */

function depotsSig(depots: ColonizeSnapshot["activeDepots"]): string {
  return depots
    .map((d) => {
      const resources = d.resources.map((r) => `${r.name}:${r.required}:${r.provided}`).join(",");
      const contributions = d.contributions.map((c) => `${c.commodityId}:${c.totalTons}`).join(",");
      /**
       * History arrays are compared by length rather than contents: they only ever grow, and
       * a new sample always arrives with a new `lastTimestamp`, which is already covered.
       */
      return [
        d.marketId,
        d.starSystem ?? "",
        d.stationName ?? "",
        d.constructionSiteLabel ?? "",
        d.progress ?? "",
        d.complete ? 1 : 0,
        d.failed ? 1 : 0,
        d.lastTimestamp ?? "",
        d.progressHistory.length,
        d.contributionProgressHistory.length,
        resources,
        contributions,
      ].join("|");
    })
    .join(";");
}

function cargoSig(lines: ColonizeSnapshot["shipCargo"]): string {
  return lines.map((c) => `${c.name}:${c.count}`).join(",");
}

function shopHistorySig(rows: ColonizeSnapshot["journalShopHistory"]): string {
  return rows
    .map(
      (e) =>
        `${e.marketId}:${e.systemName}:${e.stationName}:${e.visitedAt}:${e.commodityIds.length}:${
          e.purchases?.length ?? 0
        }:${e.cachedOffers?.length ?? 0}`,
    )
    .join("|");
}

function wingSig(rows: ColonizeSnapshot["wingRoster"]): string {
  return rows.map((r) => `${r.commanderName}:${r.lastSeenIso}`).join(",");
}

/** Reuse `previous` when the two describe the same thing, so consumers see a stable reference. */
function keepIfSame<T>(previous: T | undefined, next: T, sign: (value: T) => string): T {
  if (previous === undefined) return next;
  return sign(previous) === sign(next) ? previous : next;
}

export function stabilizeSnapshot(
  prev: ColonizeSnapshot | null,
  next: ColonizeSnapshot,
): ColonizeSnapshot {
  if (!prev) return next;
  return {
    ...next,
    activeDepots: keepIfSame(prev.activeDepots, next.activeDepots, depotsSig),
    completedDepots: keepIfSame(prev.completedDepots, next.completedDepots, depotsSig),
    archivedDepots: keepIfSame(prev.archivedDepots, next.archivedDepots, depotsSig),
    shipCargo: keepIfSame(prev.shipCargo, next.shipCargo, cargoSig),
    journalShopHistory: keepIfSame(prev.journalShopHistory, next.journalShopHistory, shopHistorySig),
    wingRoster: keepIfSame(prev.wingRoster, next.wingRoster, wingSig),
  };
}
