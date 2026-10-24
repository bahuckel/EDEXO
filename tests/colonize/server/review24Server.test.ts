/**
 * The pre-release review of 2026-10-24, Colonize server: cleared sellers stay cleared, Inara's relative "Updated"
 * text ages a seller, cached seller lists are measured from the place asked, an empty EDSM hold clears a wingmate's
 * claims, and a locked store file is not taken for a missing one.
 */
import { promises as fsp } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialBuyStationHit } from "../../../src/shared/colonize/materialBuyIndexTypes";
import { MaterialBuyIndex } from "../../../src/server/colonize/materialBuyIndex";
import { marketTimeIso, marketTimeMs, sellerTooOld } from "../../../src/shared/colonize/marketAge";

function hit(system: string, station: string, commodity: string, extra: Partial<MaterialBuyStationHit> = {}): MaterialBuyStationHit {
  return {
    systemName: system,
    stationName: station,
    marketId: `${system}-${station}`,
    distanceLy: 10,
    buyPrice: 1000,
    supply: 500,
    spanshCommodity: commodity,
    dataSource: "spansh",
    foundAtIso: new Date().toISOString(),
    ...extra,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "review24-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe("clearing saved sellers", () => {
  it("is written to disk and moves the merge generation", async () => {
    const a = new MaterialBuyIndex(dir);
    await a.load();
    a.mergeStations("Site A", "steel", "Steel", [hit("Sys 1", "Port", "Steel")]);
    await a.flush();
    const gen = a.mergeGeneration();
    await a.clearAll();
    expect(a.mergeGeneration()).toBeGreaterThan(gen);
    const b = new MaterialBuyIndex(dir);
    await b.load();
    expect(b.getAllStationsForNeed("Site A", "steel", "Steel")).toEqual([]);
  });

  it("by source is written to disk too", async () => {
    const a = new MaterialBuyIndex(dir);
    await a.load();
    a.mergeStations("Site A", "steel", "Steel", [hit("Sys 1", "Port", "Steel"), hit("Sys 2", "Yard", "Steel", { dataSource: "inara" })]);
    await a.flush();
    await a.clearBySources(["spansh"]);
    const b = new MaterialBuyIndex(dir);
    await b.load();
    expect(b.getAllStationsForNeed("Site A", "steel", "Steel").map((h) => h.systemName)).toEqual(["Sys 2"]);
  });
});

describe("seller lists measured from the place asked", () => {
  it("do not share a cached answer between two distance origins", async () => {
    const a = new MaterialBuyIndex(dir);
    await a.load();
    a.mergeStations("Hub", "steel", "Steel", [hit("Sys 1", "Port", "Steel")]);
    const fromHub = a.getAllStationsForNeed("Hub", "steel", "Steel", {}, "Hub");
    const fromSite = a.getAllStationsForNeed("Hub", "steel", "Steel", {}, "Site");
    expect(fromHub).not.toBe(fromSite);
    await a.flush();
  });
});

describe("Inara's relative Updated text", () => {
  const scraped = "2026-10-24T00:00:00.000Z";
  it("is counted back from the scrape", () => {
    expect(marketTimeIso("106 days ago", scraped)).toBe("2026-07-10T00:00:00.000Z");
    expect(marketTimeIso("2 hours ago", scraped)).toBe("2026-10-23T22:00:00.000Z");
    expect(marketTimeIso("an hour ago", scraped)).toBe("2026-10-23T23:00:00.000Z");
    expect(marketTimeIso("just now", scraped)).toBe(scraped);
    expect(marketTimeMs("2026-10-01T00:00:00Z")).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(marketTimeMs("soon", scraped)).toBeNull();
  });

  it("makes an old Inara seller too old, as saved before this fix", () => {
    const now = Date.parse(scraped);
    expect(sellerTooOld({ dataSource: "inara", marketUpdatedAt: "106 days ago", foundAtIso: scraped }, now)).toBe(true);
    expect(sellerTooOld({ dataSource: "inara", marketUpdatedAt: "12 days ago", foundAtIso: scraped }, now)).toBe(false);
    // Unreadable text falls back to when it was saved.
    expect(sellerTooOld({ dataSource: "inara", marketUpdatedAt: "?", foundAtIso: "2026-07-01T00:00:00Z" }, now)).toBe(true);
  });
});

describe("wing cargo", () => {
  it("an empty hold on EDSM clears the last sync's claims", async () => {
    vi.resetModules();
    vi.doMock("../../../src/server/colonize/edsmCommanderCargo", () => ({
      fetchEdsmCommanderCargo: async () => ({ ok: true, lines: [] }),
    }));
    const { syncWingCargoFromEdsm } = await import("../../../src/server/colonize/wingCargoSync");
    const res = await syncWingCargoFromEdsm({
      roster: [{ commanderName: "Mate", lastSeenIso: "2026-10-24T00:00:00Z" }],
      existing: [{ id: "wing-mate", name: "Mate", color: "amber", claims: [{ commodityId: "steel", label: "Steel", tons: 200 }] }],
    });
    expect(res.members[0]?.claims).toEqual([]);
    vi.doUnmock("../../../src/server/colonize/edsmCommanderCargo");
  });
});

describe("a locked store file", () => {
  it("is asked again, not taken for a missing one", async () => {
    const { readJsonKeepingCorrupt } = await import("../../../src/server/colonize/jsonFs");
    const file = path.join(dir, "state.json");
    await fsp.writeFile(file, JSON.stringify({ v: 3, kept: true }));
    const real = fsp.readFile.bind(fsp);
    let calls = 0;
    vi.spyOn(fsp, "readFile").mockImplementation(((...args: Parameters<typeof fsp.readFile>) => {
      calls++;
      if (calls < 3) return Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }));
      return real(...args);
    }) as typeof fsp.readFile);
    const got = await readJsonKeepingCorrupt<{ kept?: boolean } | null>(file, null);
    expect(got).toEqual({ value: { v: 3, kept: true }, corrupt: false });
    expect(calls).toBe(3);
  });
});
