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

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

/**
 * When a market was updated, in ms: an ISO time, or Inara's relative "Updated" text ("106 days ago", "an hour ago",
 * "just now") counted back from `anchorIso`, the moment it was read. Null when neither gives a time. Inara rows were
 * saved with that text, which never parses as a date, so they never expired (review 2026-10-24).
 */
export function marketTimeMs(updated: string | null | undefined, anchorIso?: string | null): number | null {
  const text = updated?.trim() ?? "";
  if (!text) return null;
  const t = Date.parse(text);
  if (Number.isFinite(t) && !/ago$/i.test(text)) return t;
  const anchor = Date.parse(anchorIso ?? "");
  if (!Number.isFinite(anchor)) return null;
  if (/^(just now|now|today)$/i.test(text)) return anchor;
  const m = /^(\d+|an?|one)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1;
  return anchor - n * UNIT_MS[m[2]!.toLowerCase()]!;
}

/** {@link marketTimeMs} as an ISO string, for saving. */
export function marketTimeIso(updated: string | null | undefined, anchorIso?: string | null): string | null {
  const t = marketTimeMs(updated, anchorIso);
  return t == null ? null : new Date(t).toISOString();
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
  const t = marketTimeMs(hit.marketUpdatedAt, hit.foundAtIso) ?? marketTimeMs(hit.foundAtIso);
  if (t == null) return false;
  return nowMs - t > SELLER_MAX_AGE_DAYS * 86_400_000;
}
