import { describe, expect, it } from "vitest";
import { consumeWingTonsForDepot, makeWingClaimPool, type WingMember } from "../../src/shared/colonize/wingManifest";

function member(claims: WingMember["claims"]): WingMember {
  return { id: "w1", name: "Wingmate", color: "#fff", claims };
}

describe("wing claim accounting", () => {
  it("spreads an untargeted claim across depots instead of crediting each in full", () => {
    const members = [member([{ commodityId: "steel", label: "Steel", tons: 100 }])];
    const pool = makeWingClaimPool(members);

    const first = consumeWingTonsForDepot({
      members,
      commodityId: "steel",
      depotMarketId: "depot-a",
      untargetedPool: pool,
      needTons: 80,
    });
    const second = consumeWingTonsForDepot({
      members,
      commodityId: "steel",
      depotMarketId: "depot-b",
      untargetedPool: pool,
      needTons: 80,
    });

    // 100 t is hauled once. It used to be subtracted from both depots, so the plan
    // bought 100 t too little for a two-site build.
    expect(first).toBe(80);
    expect(second).toBe(20);
    expect(first + second).toBe(100);
  });

  it("gives a targeted claim only to the depot it names", () => {
    const members = [
      member([{ commodityId: "steel", label: "Steel", tons: 50, targetDepotMarketId: "depot-a" }]),
    ];
    const pool = makeWingClaimPool(members);

    expect(
      consumeWingTonsForDepot({
        members,
        commodityId: "steel",
        depotMarketId: "depot-a",
        untargetedPool: pool,
        needTons: 90,
      }),
    ).toBe(50);
    expect(
      consumeWingTonsForDepot({
        members,
        commodityId: "steel",
        depotMarketId: "depot-b",
        untargetedPool: pool,
        needTons: 90,
      }),
    ).toBe(0);
  });

  it("never credits more than the depot still needs", () => {
    const members = [member([{ commodityId: "steel", label: "Steel", tons: 500 }])];
    const pool = makeWingClaimPool(members);

    expect(
      consumeWingTonsForDepot({
        members,
        commodityId: "steel",
        depotMarketId: "depot-a",
        untargetedPool: pool,
        needTons: 30,
      }),
    ).toBe(30);
    // The rest stays in the pool for the next site rather than evaporating.
    expect(pool.get("steel")).toBe(470);
  });

  it("keeps targeted claims out of the shared pool", () => {
    const pool = makeWingClaimPool([
      member([
        { commodityId: "steel", label: "Steel", tons: 40, targetDepotMarketId: "depot-a" },
        { commodityId: "steel", label: "Steel", tons: 10 },
      ]),
    ]);
    expect(pool.get("steel")).toBe(10);
  });
});
