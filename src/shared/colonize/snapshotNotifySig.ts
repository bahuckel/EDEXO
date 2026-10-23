import type { ColonizeSnapshot } from "./types";

/*
  What has to differ for a Colonize snapshot to be worth sending (the server's notify, colonizeService.ts) and worth
  applying (the window, useColonizeSnapshot.ts). One definition for both: the window kept its own, narrower copy, so
  pushes the server sent on purpose (a carrier, the wing, the end of a replay, an error, a colony, market offers) were
  dropped until a jump or a dock happened to change something the window did check (audit 2026-10-22).
*/

/**
 * Per-shop fingerprint. Re-docking at a station already in the history changes its visit time and
 * its market rows without changing how many shops there are, so a plain count never pushed it.
 */
function shopHistorySig(e: ColonizeSnapshot["journalShopHistory"][number]): string {
  const offers = e.cachedOffers?.length ?? 0;
  return `${e.marketId}:${e.visitedAt}:${e.purchases?.length ?? 0}:${offers}:${e.commodityIds.length}`;
}

/** What has to differ for a snapshot to be worth pushing to the window. */
export function colonizeSnapshotNotifySig(s: ColonizeSnapshot): string {
  return JSON.stringify({
    jd: s.journalDir,
    ss: s.navContext.starSystem,
    sa: s.navContext.systemAddress,
    ad: s.activeDepots.map((d) => `${d.marketId}:${d.lastTimestamp ?? ""}:${d.progress ?? ""}`),
    // Restoring a finished site from the archive moves it between these two without touching the active list.
    // (`?? []`: the slim snapshots some tests build leave both out.)
    cd: s.completedDepots?.map((d) => d.marketId) ?? [],
    ar: s.archivedDepots?.map((d) => d.marketId) ?? [],
    ld: s.liveDocked?.marketId ?? null,
    ct: s.shipCargoTimestamp,
    // What is aboard, not how many lines: two buys within one second share a timestamp (the HUD's bars stalled).
    sc: s.shipCargo.map((c) => `${c.name}:${c.count}`).join(","),
    cc: s.shipCargoCapacity,
    dm: s.dockMarket?.timestamp ?? null,
    jsh: s.journalShopHistory.map(shopHistorySig),
    /** Without this the progress strip never learns the replay finished. */
    rb: s.replayBusy,
    // Who, not how many: one mate leaving as another joins keeps the count (audit 2026-10-22).
    wr: s.wingRoster.map((r) => r.commanderName),
    /**
     * Carrier stock (phase 10) was missing, so a `CarrierStats` on its own — a new total, a new
     * name — never reached the screen until something else changed. Transfers were only shown
     * because a `Cargo` event usually follows them.
     */
    cr: s.carriers.map(
      (c) => `${c.carrierId}:${c.lastEventIso ?? ""}:${c.reportedTons ?? ""}:${c.name ?? ""}`,
    ),
    le: s.lastError,
    oc: s.ownColonies.map((c) => c.systemAddress),
  });
}
