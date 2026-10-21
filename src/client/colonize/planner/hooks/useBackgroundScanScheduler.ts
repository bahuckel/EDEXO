import { useEffect, useMemo, useRef } from "react";
import type { DepotNeedItem } from "../../../../shared/colonize/plannerDepotNeeds";
import type { ShopHistoryEntry } from "../../../../shared/colonize/shopHistory";
import type { LiveDockedInfo } from "../../../../shared/colonize/types";

/** Let a burst of journal events (dock, cargo, contribution) settle before scanning. */
const SCAN_KICKOFF_MS = 8_000;
/** Min gap between background scans — docking + cargo events can't stack scans. */
const MIN_SCAN_GAP_MS = 60_000;
/** Idle cadence once nothing worth re-scanning has changed. */
const SCAN_INTERVAL_MS = 180_000;

export type BackgroundScanSchedulerArgs = {
  /** Live Spansh scans on, tab visible, builds tracked, and materials still missing sellers. */
  enabled: boolean;
  onBackgroundScan: () => void;
  docked: LiveDockedInfo;
  navSystem: string | null | undefined;
  effectiveCapacity: number | null;
  depotNeeds: DepotNeedItem[];
  shopHistory: ShopHistoryEntry[];
  activeDepotCount: number;
};

/**
 * One timer for the background Spansh scan.
 *
 * A kick-off timeout, a repeating interval and a throttle ref used to run side by side, so what
 * actually happened depended on which of the three won a given tick. There is a single next-run
 * instant instead: a change to the trigger pulls it forward to the kick-off delay, the minimum gap
 * holds it back, and each completed scan pushes it out by the idle cadence.
 */
export function useBackgroundScanScheduler({
  enabled,
  onBackgroundScan,
  docked,
  navSystem,
  effectiveCapacity,
  depotNeeds,
  shopHistory,
  activeDepotCount,
}: BackgroundScanSchedulerArgs): void {
  const onBackgroundScanRef = useRef(onBackgroundScan);
  onBackgroundScanRef.current = onBackgroundScan;

  const shopHistoryCount = shopHistory.length;
  const latestShopVisitedAt = shopHistory[0]?.visitedAt ?? "";

  /** Everything that makes a new scan worth running. */
  const scanTrigger = useMemo(() => {
    const cmdr = docked?.starSystem || navSystem || "";
    const projectNeeds = depotNeeds
      .map((n) => `${n.id}:${n.quantityTons}`)
      .sort()
      .join(",");
    return `${cmdr}|${docked?.marketId ?? ""}|${effectiveCapacity ?? ""}|${projectNeeds}|${activeDepotCount}|${shopHistoryCount}|${latestShopVisitedAt}`;
  }, [
    docked?.starSystem,
    docked?.marketId,
    navSystem,
    effectiveCapacity,
    depotNeeds,
    activeDepotCount,
    shopHistoryCount,
    latestShopVisitedAt,
  ]);

  const lastScanAtRef = useRef(0);
  const nextRunAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    nextRunAtRef.current = Math.max(Date.now() + SCAN_KICKOFF_MS, lastScanAtRef.current + MIN_SCAN_GAP_MS);

    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(
        () => {
          lastScanAtRef.current = Date.now();
          nextRunAtRef.current = lastScanAtRef.current + SCAN_INTERVAL_MS;
          // Re-arm before scanning, so a scan that throws cannot leave the schedule stopped.
          arm();
          onBackgroundScanRef.current();
        },
        Math.max(0, nextRunAtRef.current - Date.now()),
      );
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [enabled, scanTrigger]);
}
