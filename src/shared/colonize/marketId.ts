/**
 * A market id as the one string every source agrees on, or `null`.
 *
 * Thirteen places parsed this, four different ways. The journal reducer ran strings through
 * `Number()`, so an empty `MarketID` became market "0"; the Market.json readers kept any string
 * as-is, so "128000000" and " 128000000" were two markets; two Spansh paths stripped thousands
 * separators and the rest did not. Ids are compared across the journal, Market.json, Spansh and
 * EDSM, so they have to be spelled the same way whichever one they came from.
 *
 * The rule: a finite non-negative integer, or a string of digits once commas and whitespace are
 * removed (leading zeros dropped). Anything else is not a market id.
 */
export function parseMarketId(raw: unknown): string | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null;
  }
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  return digits.replace(/^0+(?=\d)/, "");
}
