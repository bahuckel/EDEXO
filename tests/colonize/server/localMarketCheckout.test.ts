/**
 * Review 2026-11-10 B10: the live checkout from the last Market.json took any stock above zero as enough, and called
 * the market 0 Ly away wherever it was. Now the stock must cover what is needed, and the market be in the system the
 * plan is measured from.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tryCheckoutFromMarketJson } from "../../../src/server/colonize/localMarketCheckout";
import { commodityMergeBucket } from "../../../src/shared/colonize/commodityKey";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "colonize-market-"));
  writeFileSync(
    path.join(dir, "Market.json"),
    JSON.stringify({
      timestamp: "2026-11-10T10:00:00Z",
      event: "Market",
      MarketID: 128,
      StationName: "Hammond Hub",
      StarSystem: "Laso",
      StationType: "Coriolis",
      Items: [{ Name: "$steel_name;", Name_Localised: "Steel", BuyPrice: 300, SellPrice: 250, Stock: 100, Demand: 0 }],
    }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const steel = (tons: number) => [{ id: commodityMergeBucket("Steel"), name: "steel", nameLocalised: "Steel", quantityTons: tons }];

describe("checkout from the last Market.json", () => {
  it("plans the stop when it holds enough and is where the plan is measured from", async () => {
    const r = await tryCheckoutFromMarketJson(dir, steel(80), {}, "Laso");
    expect(r?.groups[0]).toMatchObject({ stationName: "Hammond Hub", distanceLy: 0 });
  });

  it("not when the stock is short of what is needed", async () => {
    expect(await tryCheckoutFromMarketJson(dir, steel(500), {}, "Laso")).toBeNull();
  });

  it("not when the market is in another system", async () => {
    expect(await tryCheckoutFromMarketJson(dir, steel(80), {}, "Sol")).toBeNull();
    expect(await tryCheckoutFromMarketJson(dir, steel(80), {})).toBeNull();
  });
});
