/**
 * What the commander pays at a Spansh / EDSM seller (review 2026-11-10 B1): the buy price, which goes with stock. The
 * sell price goes with demand. Read the other way round, every seller's cost was low by the spread and a carrier with a
 * sell order only (sell 0) was dropped.
 */
import { describe, expect, it } from "vitest";
import { parseMarketRowForPlayerBuy } from "../../src/shared/colonize/stationSellOffer";
import { normalizeSpanshMarketArray } from "../../src/server/colonize/spanshStationBuySearch";

describe("a seller's price", () => {
  it("is the buy price that goes with stock", () => {
    expect(parseMarketRowForPlayerBuy({ commodity: "Steel", supply: 2510, buy_price: 76, sell_price: 75 })?.playerBuyPrice).toBe(76);
    expect(parseMarketRowForPlayerBuy({ commodity: "Steel", supply: 900, buy_price: 68, sell_price: 45 })?.playerBuyPrice).toBe(68);
    expect(parseMarketRowForPlayerBuy({ name: "Steel", stock: 10, BuyPrice: 70, SellPrice: 50 })?.playerBuyPrice).toBe(70);
  });

  it("keeps a carrier with a sell order only", () => {
    expect(parseMarketRowForPlayerBuy({ commodity: "Steel", supply: 18000, buy_price: 3000, sell_price: 0 })).toEqual({
      commodity: "Steel",
      supply: 18000,
      playerBuyPrice: 3000,
    });
  });

  it("is the same when a normalised market is normalised again", () => {
    const once = normalizeSpanshMarketArray([{ commodity: "Steel", supply: 900, buy_price: 68, sell_price: 45 }]);
    expect(once).toEqual([{ commodity: "Steel", supply: 900, buy_price: 68, sell_price: 68 }]);
    expect(normalizeSpanshMarketArray(once)).toEqual(once);
  });
});
