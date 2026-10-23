/**
 * Saved sellers older than 60 days are not planned with (discuss item 5); the commander's own journal and stations
 * where he bought the commodity never expire.
 */
import { describe, expect, it } from "vitest";
import { SELLER_MAX_AGE_DAYS, sellerTooOld } from "../../src/shared/colonize/marketAge";

const now = Date.parse("2026-10-23T12:00:00Z");
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

describe("sellerTooOld", () => {
  it("drops a Spansh or Inara row past 60 days, by its market date first", () => {
    expect(SELLER_MAX_AGE_DAYS).toBe(60);
    expect(sellerTooOld({ dataSource: "spansh", marketUpdatedAt: daysAgo(59), foundAtIso: daysAgo(1) }, now)).toBe(false);
    expect(sellerTooOld({ dataSource: "spansh", marketUpdatedAt: daysAgo(61), foundAtIso: daysAgo(1) }, now)).toBe(true);
    expect(sellerTooOld({ dataSource: "inara", foundAtIso: daysAgo(90) }, now)).toBe(true);
  });
  it("keeps journal and bought-here sellers, and rows without a date", () => {
    expect(sellerTooOld({ dataSource: "journal", marketUpdatedAt: daysAgo(400) }, now)).toBe(false);
    expect(sellerTooOld({ dataSource: "spansh", purchaseProven: true, marketUpdatedAt: daysAgo(400) }, now)).toBe(false);
    expect(sellerTooOld({ dataSource: "spansh", foundAtIso: "" }, now)).toBe(false);
  });
});
