/**
 * The two prices on a market row are read in one place (review 2026-11-10 Phase 3, after B1): marketPrice.ts knows
 * that the commander pays `buy_price` / `BuyPrice` / `buyPrice` and the station pays `sell_price` / `SellPrice` /
 * `sellPrice`. A file reading those keys itself is how B1 happened.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { playerBuyPriceOf, stationBuyPriceOf } from "../src/shared/colonize/marketPrice.js";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("market prices", () => {
  it("take the buy price for what the commander pays, the sell price for what the station pays, any spelling", () => {
    // Spansh's carrier row from B1: buy 68 with stock, sell 45 with demand.
    const spansh = { commodity: "Steel", supply: 900, buy_price: 68, sell_price: 45 };
    expect(playerBuyPriceOf(spansh)).toBe(68);
    expect(stationBuyPriceOf(spansh)).toBe(45);
    expect(playerBuyPriceOf({ BuyPrice: 300, SellPrice: 280 })).toBe(300);
    expect(stationBuyPriceOf({ buyPrice: 12, sellPrice: 10 })).toBe(10);
    // 0 is the side a market does not trade.
    expect(playerBuyPriceOf({ buy_price: 0, sell_price: 45 })).toBeNull();
    expect(playerBuyPriceOf(null)).toBeNull();
  });

  it("are read from a raw row nowhere but marketPrice.ts", () => {
    const offenders = files("src")
      .filter((f) => !f.replace(/\\/g, "/").endsWith("shared/colonize/marketPrice.ts"))
      .filter((f) => /\.(buy_price|sell_price|BuyPrice|SellPrice)\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
