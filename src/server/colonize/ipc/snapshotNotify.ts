import type { ColonizeSnapshot } from "../../../shared/colonize/types";

/**
 * Per-shop fingerprint. Re-docking at a station already in the history changes its visit time and
 * its market rows without changing how many shops there are, so a plain count never pushed it.
 */
function shopHistorySig(e: ColonizeSnapshot["journalShopHistory"][number]): string {
  const offers = e.cachedOffers?.length ?? 0;
  return `${e.marketId}:${e.visitedAt}:${e.purchases?.length ?? 0}:${offers}:${e.commodityIds.length}`;
}

/** What has to differ for a snapshot to be worth pushing to the renderer. */
export function colonizeSnapshotNotifySig(s: ColonizeSnapshot): string {
  return JSON.stringify({
    jd: s.journalDir,
    ss: s.navContext.starSystem,
    sa: s.navContext.systemAddress,
    ad: s.activeDepots.map((d) => `${d.marketId}:${d.lastTimestamp ?? ""}:${d.progress ?? ""}`),
    ld: s.liveDocked?.marketId ?? null,
    ct: s.shipCargoTimestamp,
    sc: s.shipCargo.length,
    cc: s.shipCargoCapacity,
    dm: s.dockMarket?.timestamp ?? null,
    jsh: s.journalShopHistory.map(shopHistorySig),
    /** Without this the progress strip never learns the replay finished. */
    rb: s.replayBusy,
    wr: s.wingRoster.length,
    /**
     * Carrier stock (phase 10) was missing, so a `CarrierStats` on its own — a new total, a new
     * name — never reached the screen until something else changed. Transfers were only shown
     * because a `Cargo` event usually follows them.
     */
    cr: s.carriers.map(
      (c) => `${c.carrierId}:${c.lastEventIso ?? ""}:${c.reportedTons ?? ""}:${c.name ?? ""}`,
    ),
    le: s.lastError,
  });
}
