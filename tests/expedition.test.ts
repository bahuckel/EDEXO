/**
 * Expedition scoring (plan 2.3, 2026-10-11): boxels within a radius named as the game names them, the
 * expected first-footfall value of a boxel from a hand-built table, recorded systems taken off, position
 * rules with the boxel's half-diagonal as slack, candidate system names.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  boxelCountWithin,
  boxelEV,
  boxelEVForSpecies,
  boxelKey,
  boxelKeyAt,
  boxelPassesSpatialGate,
  boxelsWithin,
  candidateSystems,
  countRecorded,
  evPerJump,
  genusKey,
  genusValues,
  loadEvTable,
  loadSectorNames,
  type EvTable,
  type ExpeditionBoxel,
} from "../src/server/expedition.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";

const root = path.resolve(__dirname, "..");
/** Swoilz KI-E b4-9, the owner's home system (Spansh dump: boxel position 73226). */
const SWOILZ = { x: 137, y: -88.84375, z: 298.09375 };

const table: EvTable = {
  builtAt: "test",
  genera: ["Bacterium", "Stratum", "Bark Mounds"],
  byMass: {
    d: { systems: 1e6, known: 400_000, bio: 20_000, bioBodies: 40_000, signals: 80_000, dss: 10_000, genera: [8_000, 2_000, 0], sysPerBoxel: 100 },
  },
  cells: {
    "Inner Orion Spur|d": {
      systems: 50_000, known: 10_000, bio: 1_000, bioBodies: 3_000, signals: 6_000, dss: 1_000, genera: [500, 500, 10],
      sysPerBoxel: 200, boxelsEstimated: 100,
    },
    "Tiny Region|d": { systems: 100, known: 50, bio: 5, bioBodies: 5, signals: 5, dss: 5, genera: [5, 0, 0], sysPerBoxel: 9, boxelsEstimated: 2 },
  },
};
const box = (over: Partial<ExpeditionBoxel> = {}): ExpeditionBoxel => ({
  code: "d", cell: [39, 31, 19], position: 0, name: "Swoilz AA-A d0", mixed: false, center: SWOILZ, cubeLy: 80, distanceLy: 0, ...over,
});

describe("expedition: the boxels around a point", () => {
  it("finds and names the boxel a known system is in, nearest first", () => {
    const names = loadSectorNames(root);
    const { boxels, skipped } = boxelsWithin(SWOILZ, 30, ["b"], names);
    expect(skipped).toEqual([]);
    expect(boxels[0]!.name).toBe("Swoilz KI-E b4");
    expect(boxels[0]!.position).toBe(73226);
    expect(boxels[0]!.distanceLy).toBeLessThan(20);
    for (let i = 1; i < boxels.length; i++) expect(boxels[i]!.distanceLy).toBeGreaterThanOrEqual(boxels[i - 1]!.distanceLy);
    // The point's own boxel key is the enumerated one's.
    expect(boxelKeyAt("b", SWOILZ)).toBe(boxelKey(boxels[0]!));
  });

  it("skips a mass code that would enumerate too many boxels", () => {
    expect(boxelCountWithin("a", 500)).toBeGreaterThan(100_000);
    const { skipped, boxels } = boxelsWithin(SWOILZ, 500, ["a", "h"], null);
    expect(skipped).toEqual(["a"]);
    expect(boxels.every((b) => b.code === "h" && b.name === null)).toBe(true);
  });

  it("buckets recorded systems into the boxels near the field only", () => {
    const pts = [SWOILZ, { ...SWOILZ, x: SWOILZ.x + 1 }, { x: 9000, y: 0, z: 9000 }];
    const m = countRecorded(pts, SWOILZ, 50, ["b", "d"]);
    expect(m.get(boxelKeyAt("b", SWOILZ))).toBe(2);
    expect([...m.values()].reduce((a, x) => a + x, 0)).toBe(4);
  });
});

describe("expedition: what a boxel is worth", () => {
  const genusValue = [1_000_000, 4_000_000, 20_000_000];
  it("scores from the region's cell: systems x P(bio) x bodies x value per body x 5", () => {
    const s = boxelEV(box(), { table, region: "Inner Orion Spur", genusValue });
    expect(s.regional).toBe(true);
    expect(s.systems).toBe(200);
    expect(s.pBio).toBeCloseTo(0.1, 6);
    expect(s.bioBodiesPerSystem).toBe(3);
    // per DSS'd bio body: 0.5 x 1 M + 0.5 x 4 M + 0.01 x 20 M = 2.7 M
    expect(s.ev).toBeCloseTo(200 * 0.1 * 3 * 2_700_000 * 5, -2);
    expect(s.topGenera[0]!.genus).toBe("Stratum");
  });

  it("takes recorded systems off, and falls back to the mass code where the region is thin", () => {
    const full = boxelEV(box(), { table, region: "Inner Orion Spur", genusValue });
    const half = boxelEV(box(), { table, region: "Inner Orion Spur", genusValue, recorded: 10 });
    expect(half.ev).toBeCloseTo(full.ev / 2, -2);
    expect(boxelEV(box(), { table, region: "Inner Orion Spur", genusValue, recorded: 1e6 }).ev).toBe(0);
    const thin = boxelEV(box(), { table, region: "Tiny Region", genusValue });
    expect(thin.regional).toBe(false);
    expect(thin.systems).toBe(100);
    expect(thin.pBio).toBeCloseTo(0.05, 6);
  });

  it("per jump: the jumps to reach it plus one per system in it", () => {
    expect(evPerJump({ ev: 1000, systems: 9 }, 100, 50)).toEqual({ jumps: 11, evPerJump: 1000 / 11 });
  });

  it("values a genus by its species, weighted by how often each is logged", () => {
    const v = genusValues(
      ["Bark Mounds", "Stratum"],
      [
        { genus: "Bark Mounds", name: "Bark Mounds", price: 1_471_900 },
        { genus: "Stratum", name: "Stratum Tectonicas", price: 19_010_800 },
        { genus: "Stratum", name: "Stratum Paleas", price: 1_362_000 },
      ],
      (n) => (n === "Stratum Paleas" ? 3 : 1),
    );
    expect(v[0]).toBe(1_471_900);
    expect(v[1]).toBeCloseTo((19_010_800 + 3 * 1_362_000) / 4, 0);
    expect(genusKey("Amphora Plant")).toBe(genusKey("Amphora"));
    expect(genusKey("Brain Trees")).toBe(genusKey("Brain Tree"));
  });
});

describe("expedition: target species", () => {
  const cat = loadSpatialCatalogue(root);
  it("lights radialem only where its nebula rule can be met, with the boxel's half-diagonal as slack", () => {
    // Inside the Coalsack: passes. The owner's home, 175 ly from R CrA: a 20 ly b boxel cannot reach 150 ly,
    // an 80 ly d boxel (half-diagonal 69 ly) can.
    expect(boxelPassesSpatialGate("electricae_electricae_radialem", box({ center: { x: 340, y: 10, z: 210 } }), cat)).toBe(true);
    expect(boxelPassesSpatialGate("electricae_electricae_radialem", box({ code: "b", cubeLy: 20 }), cat)).toBe(false);
    expect(boxelPassesSpatialGate("electricae_electricae_radialem", box({ cubeLy: 80 }), cat)).toBe(true);
    // No position rule: always.
    expect(boxelPassesSpatialGate("stratum_stratum_paleas", box({ code: "b", cubeLy: 20 }), cat)).toBe(true);
  });

  it("expects species bodies from the genus rate and its share in the genus", () => {
    const r = boxelEVForSpecies(box(), {
      table, region: "Inner Orion Spur", genus: "Stratum", speciesId: "stratum_stratum_paleas", shareInGenus: 0.25, catalogue: cat,
    });
    // 200 x 0.1 bio systems x 3 bodies x 0.5 Stratum x 0.25
    expect(r.bodies).toBeCloseTo(7.5, 6);
    const none = boxelEVForSpecies(box({ code: "b", cubeLy: 20 }), {
      table, region: "Inner Orion Spur", genus: "Electricae", speciesId: "electricae_electricae_radialem", shareInGenus: 1, catalogue: cat,
    });
    expect(none).toEqual({ bodies: 0, passesGate: false });
  });
});

describe("expedition: candidate systems", () => {
  it("lists the boxel's procedural names without the recorded ones", () => {
    const names = candidateSystems(box({ name: "Swoilz KI-E b4" }), 12, new Set(["swoilz ki-e b4-9", "swoilz ki-e b4-0"]));
    expect(names).toHaveLength(10);
    expect(names[0]).toBe("Swoilz KI-E b4-1");
    expect(names).not.toContain("Swoilz KI-E b4-9");
    expect(candidateSystems(box({ name: null }), 12, new Set())).toEqual([]);
  });

  it("loads the shipped table", () => {
    const t = loadEvTable(root);
    expect(Object.keys(t.byMass)).toHaveLength(8);
    const s = boxelEV(box(), { table: t, region: "Inner Orion Spur", genusValue: t.genera.map(() => 1_000_000) });
    expect(s.ev).toBeGreaterThan(0);
  });
});
