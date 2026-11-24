/**
 * The whole-galaxy hunt (plan-1.4.0 §6.2, owner 2026-11-15: "entire galaxy search ... it scans unfinished H boxels
 * because that's where they are located most often"): every g / h boxel of the named sectors, the target's commonest
 * code by default, systems already flown taken off what is left to find.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { boxelsInGalaxy, boxelsWithin, boxelKey, GALAXY_CODES, loadSectorNames } from "../src/server/expedition.js";
import { galaxyCodesFor, loadFeatureTable } from "../src/server/expeditionTargets.js";
import { expeditionField, type ExpeditionDeps } from "../src/server/expeditionService.js";
import { loadRegionMap } from "../src/server/regionMapData.js";
import { loadPriceList } from "../src/server/priceList.js";
import { buildEncyclopediaPayload, getCachedSpeciesDatabase } from "../src/server/snapshot.js";
import type { BioIndex } from "../src/server/bioIndex.js";

const root = path.resolve(__dirname, "..");
const SOL = { x: 0, y: 0, z: 0 };
const WR = { kind: "star" as const, star: "Wolf-Rayet" };

function fakeIndex(points: { x: number; y: number; z: number }[]): BioIndex {
  return {
    systemCount: points.length,
    forEachPoint: (cb: (i: number, x: number, y: number, z: number, t: number, n: number) => void) =>
      points.forEach((p, i) => cb(i, p.x, p.y, p.z, 0, 1)),
    forEachPointIn: (from: number, to: number, cb: (i: number, x: number, y: number, z: number, t: number, n: number) => void) => {
      for (let i = from; i < to; i++) cb(i, points[i]!.x, points[i]!.y, points[i]!.z, 0, 1);
    },
  } as unknown as BioIndex;
}

function deps(points: { x: number; y: number; z: number }[] = []): ExpeditionDeps {
  buildEncyclopediaPayload();
  return {
    root,
    index: fakeIndex(points),
    prices: loadPriceList(root),
    species: getCachedSpeciesDatabase().species,
    regionMap: loadRegionMap(root),
    catalogue: null,
  };
}

describe("whole-galaxy hunt", () => {
  const names = loadSectorNames(root);

  it("lists one h and eight g boxels per named sector, named and placed as the sphere does", () => {
    const h = boxelsInGalaxy(["h"], names, SOL);
    expect(h).toHaveLength(names.byCell.size);
    expect(boxelsInGalaxy(["g"], names, SOL)).toHaveLength(names.byCell.size * 8);
    // Near Sol it is the same boxel, name and centre as the sphere's.
    const near = boxelsWithin(SOL, 2000, ["h"], names).boxels.filter((b) => b.name);
    const byKey = new Map(h.map((b) => [boxelKey(b), b]));
    for (const b of near) {
      const g = byKey.get(boxelKey(b))!;
      expect(g.name).toBe(b.name);
      expect(g.center).toEqual(b.center);
      expect(g.distanceLy).toBeCloseTo(b.distanceLy, 6);
    }
  });

  it("picks the codes where the target is commonest", () => {
    const t = loadFeatureTable(root);
    expect(galaxyCodesFor(WR, t, GALAXY_CODES)).toEqual(["h"]);
    expect(galaxyCodesFor({ kind: "exobio" }, t, GALAXY_CODES)).toEqual(["g", "h"]);
    // A neutron star is a d or e boxel's: none of the galaxy's codes, the commonest of all says so.
    expect(galaxyCodesFor({ kind: "star", star: "Neutron Star" }, t, ["a", "b", "c", "d", "e", "f", "g", "h"])).toEqual(["e"]);
  });

  it("scores every boxel of the code, nearest first through the jumps, and takes flown systems off", async () => {
    const open = await expeditionField({ from: SOL, radiusLy: 0, jumpRangeLy: 60, target: WR, galaxy: true, limit: 500 }, deps());
    expect(open.galaxy).toBe(true);
    expect(open.codes).toEqual(["h"]);
    expect(open.commonestCodes).toEqual(["h"]);
    expect(open.scored).toBeGreaterThan(10_000);
    expect(open.boxels).toHaveLength(500);
    const top = open.boxels[0]!;
    expect(top.distanceLy).toBeLessThan(3000);
    // Recorded systems are flown systems: the boxel holds fewer to find (another jump range: a field is cached).
    const flown = Array.from({ length: 30 }, () => top.center);
    const crowded = await expeditionField(
      { from: SOL, radiusLy: 0, jumpRangeLy: 61, target: WR, galaxy: true, limit: 500 },
      deps(flown),
    );
    const again = crowded.boxels.find((b) => b.key === top.key)!;
    expect(again.recorded).toBe(30);
    expect(again.matches!).toBeLessThan(top.matches!);
  });
});
