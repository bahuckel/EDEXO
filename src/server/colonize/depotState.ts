import { normalizeConstructionProgress } from "../../shared/colonize/constructionProgress";
import { personalContributionProgress } from "../../shared/colonize/personalContributionProgress";
import { commodityMergeBucket } from "../../shared/colonize/commodityKey";
import type { ContributionRecord, DepotSnapshot, ProgressHistoryPoint, ResourceRow } from "../../shared/colonize/types";

/**
 * One construction site as the store holds it, plus the bookkeeping the snapshot does not carry.
 *
 * Extracted from ColonizeStore so these can be exercised without an Electron app object; the
 * replay-idempotence rules in particular are worth testing directly.
 */
export type ResourceInternal = ResourceRow;

export type DepotInternal = {
  marketId: string;
  starSystem: string | null;
  systemAddress: number | null;
  stationName: string | null;
  constructionSiteLabel: string | null;
  progress: number | null;
  complete: boolean;
  failed: boolean;
  lastTimestamp: string | null;
  resources: ResourceInternal[];
  contributions: ContributionRecord[];
  progressHistory: ProgressHistoryPoint[];
  contributionProgressHistory: ProgressHistoryPoint[];
  /** You docked at this orbital construction and/or contributed here — hide “random” market-only depots. */
  engaged: boolean;
  /** User hid this project — listed under Archived until restored. */
  userArchived: boolean;
};

export function emptyDepot(marketId: string): DepotInternal {
  return {
    marketId,
    starSystem: null,
    systemAddress: null,
    stationName: null,
    constructionSiteLabel: null,
    progress: null,
    complete: false,
    failed: false,
    lastTimestamp: null,
    resources: [],
    contributions: [],
    progressHistory: [],
    contributionProgressHistory: [],
    engaged: false,
    userArchived: false,
  };
}

const PROGRESS_HISTORY_MAX = 240;

export function appendProgressHistory(d: DepotInternal, progress: number, timestamp: string | null): void {
  progress = normalizeConstructionProgress(progress);
  if (!Number.isFinite(progress)) return;
  const ts = timestamp ?? new Date().toISOString();
  const last = d.progressHistory[d.progressHistory.length - 1];
  /** Replayed samples at or before the newest one are repeats, not new information. */
  if (last && ts <= last.timestamp) return;
  if (last && Math.abs(last.progress - progress) < 0.0005 && last.timestamp === ts) return;
  if (last && Math.abs(last.progress - progress) < 0.0005) {
    d.progressHistory[d.progressHistory.length - 1] = { timestamp: ts, progress };
    return;
  }
  d.progressHistory.push({ timestamp: ts, progress });
  if (d.progressHistory.length > PROGRESS_HISTORY_MAX) {
    d.progressHistory = d.progressHistory.slice(-PROGRESS_HISTORY_MAX);
  }
}

function appendContributionProgressHistory(
  d: DepotInternal,
  progress: number,
  timestamp: string | null,
): void {
  progress = normalizeConstructionProgress(progress);
  if (!Number.isFinite(progress)) return;
  const ts = timestamp ?? new Date().toISOString();
  const last = d.contributionProgressHistory[d.contributionProgressHistory.length - 1];
  /** Replayed samples at or before the newest one are repeats, not new information. */
  if (last && ts < last.timestamp) return;
  if (last && Math.abs(last.progress - progress) < 0.0005) return;
  d.contributionProgressHistory.push({ timestamp: ts, progress });
  if (d.contributionProgressHistory.length > PROGRESS_HISTORY_MAX) {
    d.contributionProgressHistory = d.contributionProgressHistory.slice(-PROGRESS_HISTORY_MAX);
  }
}

export function syncContributionProgressSample(d: DepotInternal, timestamp: string | null): void {
  if (!d.contributions.length) return;
  const progress = personalContributionProgress(d.contributions, d.resources);
  appendContributionProgressHistory(d, progress, timestamp);
}

export function internalToSnapshot(d: DepotInternal): DepotSnapshot {
  return {
    marketId: d.marketId,
    starSystem: d.starSystem,
    systemAddress: d.systemAddress,
    stationName: d.stationName,
    constructionSiteLabel: d.constructionSiteLabel,
    progress: d.progress,
    complete: d.complete,
    failed: d.failed,
    lastTimestamp: d.lastTimestamp,
    resources: d.resources.map((r) => ({ ...r })),
    contributions: d.contributions.map((c) => ({ ...c })),
  };
}

export function recordContribution(
  d: DepotInternal,
  name: string,
  nameLocalised: string,
  amount: number,
  timestamp: string | null,
): void {
  const bucket = commodityMergeBucket(name) || commodityMergeBucket(nameLocalised);
  if (!bucket || amount <= 0) return;
  let cur = d.contributions.find((c) => c.commodityId === bucket);
  /**
   * `totalTons` is a running sum, so a replayed event must not be added twice.
   * Anything at or before the newest timestamp already recorded for this commodity
   * has been counted in an earlier session (or earlier in this replay).
   */
  if (cur && timestamp && cur.lastTimestamp && timestamp <= cur.lastTimestamp) return;
  if (!cur) {
    cur = {
      commodityId: bucket,
      name: name || nameLocalised,
      nameLocalised: nameLocalised || name,
      totalTons: 0,
      lastTimestamp: timestamp,
    };
    d.contributions.push(cur);
  }
  cur.totalTons += amount;
  if (timestamp) cur.lastTimestamp = timestamp;
}

export function isDepotCompleted(d: DepotInternal): boolean {
  if (d.complete || d.failed) return true;
  if (d.progress != null && d.progress >= 1) return true;
  return false;
}

export function sortDepotSnapshots(rows: DepotSnapshot[]): DepotSnapshot[] {
  return [...rows].sort((a, b) => (b.lastTimestamp ?? "").localeCompare(a.lastTimestamp ?? ""));
}
