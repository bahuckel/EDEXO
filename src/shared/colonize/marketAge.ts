/** Human-readable age for journal / market timestamps (ISO 8601). */
export function formatMarketAge(iso: string | null | undefined, nowMs = Date.now()): string | null {
  if (!iso?.trim()) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffMs = Math.max(0, nowMs - t);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/**
 * How old a saved seller's market may be before the plan stops using it (discuss item 5, owner 2026-10-23: 60 days).
 * Spansh and Inara rows never expired before; 14 days only decided when to look again.
 */
export const SELLER_MAX_AGE_DAYS = 60;

/**
 * A seller too old to plan with: its market (else when it was saved) is older than {@link SELLER_MAX_AGE_DAYS}.
 * Sellers from the commander's own journal and stations where he bought the commodity never expire; a row without a
 * readable date is kept (nothing says it is old).
 */
export function sellerTooOld(
  hit: { dataSource?: string | null; purchaseProven?: boolean; marketUpdatedAt?: string | null; foundAtIso?: string | null },
  nowMs = Date.now(),
): boolean {
  if (hit.dataSource === "journal" || hit.purchaseProven) return false;
  const t = Date.parse(hit.marketUpdatedAt || hit.foundAtIso || "");
  if (!Number.isFinite(t)) return false;
  return nowMs - t > SELLER_MAX_AGE_DAYS * 86_400_000;
}
