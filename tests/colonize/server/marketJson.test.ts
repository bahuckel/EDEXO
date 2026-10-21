import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMarketJson } from "../../../src/server/colonize/marketJson";
import { readMarketSupplyBrief } from "../../../src/server/colonize/marketSupplyBrief";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "market-json-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (body: string) => writeFile(path.join(dir, "Market.json"), body, "utf8");

describe("readMarketJson", () => {
  it("says why it could not read the file", async () => {
    expect(await readMarketJson(dir)).toEqual({ ok: false, reason: "unreadable" });
    await write("{ half a file");
    expect(await readMarketJson(dir)).toEqual({ ok: false, reason: "invalid" });
    await write(JSON.stringify({ event: "Outfitting" }));
    expect(await readMarketJson(dir)).toEqual({ ok: false, reason: "not-market" });
    await write("null");
    expect(await readMarketJson(dir)).toEqual({ ok: false, reason: "not-market" });
  });

  it("returns the market", async () => {
    await write(JSON.stringify({ event: "Market", MarketID: 128000000, StationName: "Abraham Lincoln" }));
    const r = await readMarketJson(` ${dir} `);
    expect(r.ok && r.market.StationName).toBe("Abraham Lincoln");
  });

  it("still gives the commander the same messages through the supply brief", async () => {
    expect(await readMarketSupplyBrief(dir)).toEqual({
      ok: false,
      err: "Market.json unreadable (dock + open commodities at target station).",
    });
    await write(JSON.stringify({ event: "Market", MarketID: "128,000,000", StationName: "X", StarSystem: "Sol", Items: [] }));
    const ok = await readMarketSupplyBrief(dir);
    expect(ok.ok && ok.marketId).toBe("128000000");
  });
});
