import { colonizeSnapshotNotifySig } from "../../../shared/colonize/snapshotNotifySig";
import type { ColonizeSnapshot } from "../../../shared/colonize/types";
import { reuseUnchanged } from "../../snapshotMerge";

/**
 * Carry unchanged parts of a snapshot forward by reference.
 *
 * The snapshot crosses the socket as JSON, so every push hands the window brand-new arrays
 * even for the parts that did not change. Cargo changes constantly while
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
      // A new progress sample always arrives with a new `lastTimestamp` (the histories are not pushed any more).
      return [
        d.marketId,
        d.starSystem ?? "",
        d.stationName ?? "",
        d.constructionSiteLabel ?? "",
        d.progress ?? "",
        d.complete ? 1 : 0,
        d.failed ? 1 : 0,
        d.lastTimestamp ?? "",
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

/**
 * Whether a push is worth applying in the window: everything the server pushes for (one shared rule,
 * shared/colonize/snapshotNotifySig.ts), plus where the ship is docked by name, which only the window shows. The
 * window's own narrower copy dropped carrier, wing, replay, error, colony and market-offer pushes (audit 2026-10-22).
 */
export function colonizeWindowSnapSig(s: ColonizeSnapshot): string {
  return `${colonizeSnapshotNotifySig(s)}|${JSON.stringify([s.liveDocked?.stationName ?? null, s.liveDocked?.starSystem ?? null])}`;
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
    /*
      The server builds these afresh for every snapshot (`carriers` is a new [] even with no carrier), so without this
      every applied push, an FSD jump among them, rebuilt the cargo map, the needs, the haul plan and the summary
      (audit 2026-10-22). Small values: compared whole, as Compare's own snapshot is (snapshotMerge.ts).
    */
    carriers: reuseUnchanged(prev.carriers, next.carriers),
    liveDocked: reuseUnchanged(prev.liveDocked, next.liveDocked),
    dockMarket: reuseUnchanged(prev.dockMarket, next.dockMarket),
    ownColonies: reuseUnchanged(prev.ownColonies, next.ownColonies),
    navContext: reuseUnchanged(prev.navContext, next.navContext),
  };
}
