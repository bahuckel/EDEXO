/**
 * Expedition API service (plan 2.4, 2026-10-11): the field with recorded systems from the galaxy index,
 * target-species mode, the cut-down catalogue giving the same verdicts as the whole one, the plan's order
 * and totals, a boxel's candidates.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { boxelPassesSpatialGate, boxelsWithin, boxelKey, loadSectorNames } from "../src/server/expedition.js";
import { catalogueNear, expeditionCandidates, expeditionField, expeditionPlan, type ExpeditionDeps } from "../src/server/expeditionService.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";
import { loadRegionMap } from "../src/server/regionMapData.js";
import { loadPriceList } from "../src/server/priceList.js";
import { buildEncyclopediaPayload, getCachedSpeciesDatabase } from "../src/server/snapshot.js";
import type { BioIndex } from "../src/server/bioIndex.js";

const root = path.resolve(__dirname, "..");
const SWOILZ = { x: 137, y: -88.84375, z: 298.09375 };
const COALSACK = { x: 340, y: 10, z: 210 };

function fakeIndex(points: { x: number; y: number; z: number }[]): BioIndex {
  return {
    systemCount: points.length,
    forEachPoint: (cb: (i: number, x: number, y: number, z: number, t: number, n: number) => void) => points.forEach((p, i) => cb(i, p.x, p.y, p.z, 0, 1)),
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
    catalogue: loadSpatialCatalogue(root),
  };
}

describe("expedition service", () => {
  it("cuts the catalogue without changing a verdict", () => {
    const cat = loadSpatialCatalogue(root)!;
    const cut = catalogueNear(cat, COALSACK, 400 + 150 + 50 + 1109)!;
    expect(cut.records!.radialem!.length).toBeLessThan(cat.records!.radialem!.length);
    const { boxels } = boxelsWithin(COALSACK, 400, ["d", "e", "f", "g", "h"], null);
    for (const sp of ["electricae_electricae_radialem", "bark_mounds_bark_mounds", "brain_trees_brain_tree_aureum", "sinuous_tuber_sinuous_tubers_roseum"]) {
      for (const b of boxels) expect(boxelPassesSpatialGate(sp, b, cut), `${sp} ${boxelKey(b)}`).toBe(boxelPassesSpatialGate(sp, b, cat));
    }
    // Far from everything, the nearest point stays, so a gate still has something to measure.
    const lone = catalogueNear(cat, { x: 0, y: 30000, z: 0 }, 10)!;
    expect(lone.nebulae).toHaveLength(1);
  });

  it("scores the field, takes recorded systems off, and caches", async () => {
    const d = deps();
    const open = await expeditionField({ from: SWOILZ, radiusLy: 300, jumpRangeLy: 60, codes: ["d"], limit: 500 }, d);
    expect(open.boxels.length).toBeGreaterThan(10);
    expect(open.skipped).toEqual([]);
    const top = open.boxels[0]!;
    expect(top.name).toMatch(/ d\d*$/);
    for (let i = 1; i < open.boxels.length; i++) expect(open.boxels[i]!.evPerJump).toBeLessThanOrEqual(open.boxels[i - 1]!.evPerJump);
    // The same field again is the cached answer.
    expect(await expeditionField({ from: SWOILZ, radiusLy: 300, jumpRangeLy: 60, codes: ["d"], limit: 500 }, d)).toBe(open);
    // Three recorded systems in the top boxel lower its value.
    const crowded = deps([top.center, top.center, top.center]);
    const again = await expeditionField({ from: { ...SWOILZ, x: SWOILZ.x + 0.1 }, radiusLy: 301, jumpRangeLy: 60, codes: ["d"], limit: 500 }, crowded);
    const same = again.boxels.find((b) => b.key === top.key)!;
    expect(same.recorded).toBe(3);
    expect(same.ev).toBeLessThan(top.ev);
  });

  it("lights only boxels a species' position rule allows", async () => {
    const f = await expeditionField(
      { from: COALSACK, radiusLy: 400, jumpRangeLy: 60, codes: ["d", "e"], speciesId: "electricae_electricae_radialem", limit: 500 },
      deps(),
    );
    expect(f.species).toBe("electricae_electricae_radialem");
    expect(f.boxels.length).toBeGreaterThan(0);
    for (const b of f.boxels) {
      expect(b.passesGate).toBe(true);
      expect(b.speciesBodies).toBeGreaterThan(0);
    }
  });

  it("orders a plan from the ship and adds up its legs", () => {
    const names = loadSectorNames(root);
    const { boxels } = boxelsWithin(SWOILZ, 400, ["d"], names);
    const far = boxels.at(-1)!;
    const near = boxels[0]!;
    const plan = expeditionPlan([boxelKey(far), boxelKey(near), "nonsense"], { from: SWOILZ, jumpRangeLy: 50 }, { root });
    expect(plan.stops.map((s) => s.key)).toEqual([boxelKey(near), boxelKey(far)]);
    // Each leg is rounded on its own: the total may differ by under a light year per stop.
    expect(Math.abs(plan.totalLy - plan.stops.reduce((a, s) => a + s.legLy, 0))).toBeLessThanOrEqual(plan.stops.length);
    expect(plan.totalLy).toBeGreaterThan(0);
    expect(plan.totalJumps).toBe(plan.stops.reduce((a, s) => a + s.legJumps, 0));
  });

  it("lists a boxel's unrecorded system names", () => {
    const out = expeditionCandidates(
      "b:39,31,19:73226",
      { from: SWOILZ, jumpRangeLy: 50, knownNames: () => new Set(["swoilz ki-e b4-9"]) },
      deps(),
    )!;
    expect(out.boxel.name).toBe("Swoilz KI-E b4");
    expect(out.candidates).not.toContain("Swoilz KI-E b4-9");
    expect(out.candidates[0]).toBe("Swoilz KI-E b4-0");
    expect(expeditionCandidates("bad", { from: SWOILZ, jumpRangeLy: 50, knownNames: () => new Set() }, deps())).toBeNull();
  });
});
