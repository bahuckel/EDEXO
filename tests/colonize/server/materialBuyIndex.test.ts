import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MaterialBuyStationHit } from "../../../src/shared/colonize/materialBuyIndexTypes";
import { MaterialBuyIndex } from "../../../src/server/colonize/materialBuyIndex";

function hit(system: string, station: string, commodity: string, supply = 500): MaterialBuyStationHit {
  return {
    systemName: system,
    stationName: station,
    marketId: `${system}-${station}`,
    distanceLy: 10,
    buyPrice: 1000,
    supply,
    spanshCommodity: commodity,
    dataSource: "spansh",
    foundAtIso: "2026-09-23T00:00:00Z",
  };
}

let dir: string;
let index: MaterialBuyIndex;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "buy-index-"));
  index = new MaterialBuyIndex(dir);
  await index.load();
});

afterEach(async () => {
  await index.flush();
  await rm(dir, { recursive: true, force: true });
});

/** What `hasCheckoutDataAnyRef` used to compute, one full cross-reference scan per reference. */
function perReference(id: string, label: string): boolean {
  return index.allReferenceKeys().some((ref) => index.getAllStationsForNeed(ref, id, label).length > 0);
}

describe("hasCheckoutDataAnyRef (PERF-M6)", () => {
  it("answers what the per-reference scan answered", () => {
    index.mergeStations("Site A", "steel", "Steel", [hit("Sys 1", "Port", "Steel")]);
    index.mergeStations("Site B", "cmmcomposite", "CMM Composite", [hit("Sys 2", "Dock", "CMM Composite")]);
    index.mergeStations("inara", "steel", "Steel", [hit("Sys 3", "Yard", "Steel")]);
    /** Demand-only rows are not sellers: supply without a price is rejected at merge. */
    index.mergeStations("Site C", "titanium", "Titanium", [{ ...hit("Sys 4", "Mine", "Titanium"), buyPrice: null }]);

    const needs: Array<[string, string]> = [
      ["steel", "Steel"],
      ["cmmcomposite", "CMM Composite"],
      ["", "CMM Composite"],
      ["titanium", "Titanium"],
      ["aluminium", "Aluminium"],
      ["", ""],
    ];
    for (const [id, label] of needs) {
      expect(index.hasCheckoutDataAnyRef(id, label), `${id}/${label}`).toBe(perReference(id, label));
    }
    expect(index.hasCheckoutDataAnyRef("steel", "Steel")).toBe(true);
    expect(index.hasCheckoutDataAnyRef("titanium", "Titanium")).toBe(false);
  });

  it("sees a merge into another reference straight away", () => {
    index.mergeStations("Site A", "steel", "Steel", [hit("Sys 1", "Port", "Steel")]);
    expect(index.hasCheckoutDataAnyRef("aluminium", "Aluminium")).toBe(false);
    index.mergeStations("Site B", "aluminium", "Aluminium", [hit("Sys 2", "Dock", "Aluminium")]);
    expect(index.hasCheckoutDataAnyRef("aluminium", "Aluminium")).toBe(true);
    expect(index.getAllStationsForNeed("Site A", "aluminium", "Aluminium")).toHaveLength(1);
  });
});
