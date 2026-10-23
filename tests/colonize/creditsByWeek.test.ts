/**
 * Credits per system by the game's week (discuss item 33): paid to you at the site's rate, spent at the last price
 * paid before the delivery, weeks from Thursday 07:00 UTC.
 */
import { describe, expect, it } from "vitest";
import { creditsBySystem, weekStart } from "../../src/shared/colonize/creditsByWeek";

describe("weekStart", () => {
  it("is the Thursday 07:00 UTC at or before the moment", () => {
    expect(new Date(weekStart(Date.parse("2026-10-23T12:00:00Z"))).toISOString()).toBe("2026-10-22T07:00:00.000Z");
    expect(new Date(weekStart(Date.parse("2026-10-22T06:59:59Z"))).toISOString()).toBe("2026-10-15T07:00:00.000Z");
    expect(new Date(weekStart(Date.parse("2026-10-22T07:00:00Z"))).toISOString()).toBe("2026-10-22T07:00:00.000Z");
  });
});

describe("creditsBySystem", () => {
  const site = (starSystem: string, payments: [string, number][], ledger: [string, string, number][]) => ({
    starSystem,
    payments: new Map(payments),
    ledger: ledger.map(([at, commodityId, tons]) => ({ at, commodityId, tons })),
  });

  it("adds paid and spent per week, newest week first, with tons that have no price apart", () => {
    const out = creditsBySystem(
      [
        site("Kraepelin Home", [["steel", 5000], ["titanium", 6000]], [
          ["2026-10-16T10:00:00Z", "steel", 100],
          ["2026-10-23T10:00:00Z", "steel", 50],
          ["2026-10-23T11:00:00Z", "titanium", 20],
        ]),
        site("Kraepelin Home", [["steel", 5000]], [["2026-10-23T12:00:00Z", "steel", 10]]),
      ],
      [
        { commodityId: "steel", buyPrice: 400, boughtAt: "2026-10-16T09:00:00Z" },
        { commodityId: "steel", buyPrice: 500, boughtAt: "2026-10-23T09:00:00Z" },
        { commodityId: "steel", buyPrice: 9999, boughtAt: "2026-10-24T09:00:00Z" },
      ],
    );
    expect(out).toHaveLength(1);
    const [k] = out;
    expect(k!.weeks.map((w) => w.week)).toEqual(["2026-10-22T07:00:00.000Z", "2026-10-15T07:00:00.000Z"]);
    expect(k!.weeks[0]).toMatchObject({ tons: 80, paid: 60 * 5000 + 20 * 6000, spent: 60 * 500, unpricedTons: 20 });
    expect(k!.weeks[1]).toMatchObject({ tons: 100, paid: 500000, spent: 40000, unpricedTons: 0 });
    expect(k!.total).toEqual({ tons: 180, paid: 920000, spent: 70000, unpricedTons: 20 });
  });

  it("leaves out sites with no deliveries or no system", () => {
    expect(creditsBySystem([site("A", [], []), { starSystem: null, payments: new Map(), ledger: [{ at: "2026-10-23T00:00:00Z", commodityId: "x", tons: 1 }] }], [])).toEqual([]);
  });
});
