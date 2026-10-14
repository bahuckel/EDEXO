/**
 * INCLUDE-BODY-IDS Phase 7 — the spatial spawn gates.
 *
 * Three genera are gated on where a system *is* rather than on anything a body scan reports. The
 * thresholds are measured, not chosen, and the tests carry the measurement so a future edit to a
 * number has to argue with the evidence rather than just change a constant.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SPATIAL_GATES,
  describeVerdict,
  distanceLy,
  evaluateSpatialGate,
  gateForSpeciesId,
  nearestPoint,
} from "../src/shared/spatialGates.js";
import { loadSpatialCatalogue } from "../src/server/spatialCatalogue.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cat = loadSpatialCatalogue(root)!;

/** Swoilz KI-E b4-9 — the owner's home system, and the case that reported the bug. */
const HOME = { x: 137, y: -88.84375, z: 298.09375 };

describe("the shipped catalogue", () => {
  it("carries the points the gates need", () => {
    expect(cat).toBeTruthy();
    // 346 = real + procgen. Planetary nebulae are excluded on evidence: not one of 88 Bark Mound
    // systems had one as its nearest neighbour.
    expect(cat.nebulae.length).toBe(346);
    expect(cat.guardian.length).toBe(362);
    expect(cat.core.n).toBe("Sagittarius A*");
  });

  it("says where its points came from", () => {
    expect(cat.sources.nebulae).toMatch(/edastro/i);
    expect(cat.sources.guardian).toMatch(/edsmPOI/i);
  });
});

describe("which species carry a gate", () => {
  it("catches the three gated genera and nothing else", () => {
    expect(gateForSpeciesId("electricae_electricae_radialem")?.kind).toBe("nebula");
    expect(gateForSpeciesId("brain_tree_roseum_brain_tree")?.kind).toBe("guardian");
    expect(gateForSpeciesId("sinuous_tuber_sinuous_tubers_prasinum")?.kind).toBe("core");
    for (const id of [
      "electricae_electricae_pluma", // star-gated, and the control: 0 % within 150 ly of a nebula
      "bacterium_bacterium_aurasus",
      "tussock_tussock_ignis",
      "osseus_osseus_discus",
    ]) {
      expect(gateForSpeciesId(id), id).toBeNull();
    }
  });

  it("keeps the measured evidence beside every threshold", () => {
    for (const { gate } of SPATIAL_GATES) {
      expect(gate.evidence.length).toBeGreaterThan(20);
      expect(gate.evidence).toMatch(/%/);
    }
  });
});

describe("evaluating a gate", () => {
  it("fails radialem at the reported system — 175 ly, rule is 150, inside the 200 ly band", () => {
    const v = evaluateSpatialGate("electricae_electricae_radialem", HOME, cat)!;
    expect(v.passes).toBe(false);
    expect(Math.round(v.distanceLy)).toBe(175);
    expect(v.nearestName).toBe("R Cra");
    // No planetary nebula within 110 ly and the nearest radialem cluster 85 ly off, but inside the
    // 150-200 ly band (owner, 2026-10-14): kept at a tenth of its chance.
    expect(v.softBand).toEqual({ factor: 0.1, bandLy: 200 });
    expect(v.planetary!.distanceLy).toBeGreaterThan(110);
    expect(Math.round(v.record!.distanceLy)).toBe(85);
    expect(describeVerdict(v)).toBe(
      "nearest nebula R Cra is 175 ly away — past the 150 ly rule but inside 200 ly, so it stays listed at 10 % of its chance.",
    );
  });

  it("passes radialem beside a nebula", () => {
    const n = cat.nebulae[0]!;
    const v = evaluateSpatialGate("electricae_electricae_radialem", { x: n.x + 40, y: n.y, z: n.z }, cat)!;
    expect(v.passes).toBe(true);
    expect(describeVerdict(v)).toContain("inside the 150 ly rule");
  });

  it("passes Brain Trees in the bubble and fails the Tubers there", () => {
    // The bubble is well inside 1,000 ly of a Guardian site and ~25 kly from the core.
    expect(evaluateSpatialGate("brain_tree_roseum_brain_tree", HOME, cat)!.passes).toBe(true);
    const tubers = evaluateSpatialGate("sinuous_tuber_sinuous_tubers_prasinum", HOME, cat)!;
    expect(tubers.passes).toBe(false);
    expect(describeVerdict(tubers)).toContain("Sagittarius A*");
  });

  it("passes Brain Trees in Norma Expanse, just past 1,000 ly from the nearest Guardian site", () => {
    // Graea Hypue MO-X b2-1: a confirmed Brain Tree Puniceum system. All 4,142 confirmed Brain Tree
    // bodies lie within 1,223 ly; the 83 past 1,000 are all in Norma Expanse.
    const graea = { x: -1247.8125, y: -1001.15625, z: 13086.5 };
    const v = evaluateSpatialGate("brain_trees_brain_tree_puniceum", graea, cat)!;
    expect(v.distanceLy).toBeGreaterThan(1000);
    expect(v.passes).toBe(true);
  });

  it("Crystalline Shards: at least 19,500 ly from the core (2026-10-09)", () => {
    // The bubble is ~25.9 kly out: far enough. Near the core: not.
    const home = evaluateSpatialGate("crystalline_shards_crystalline_shards", HOME, cat)!;
    expect(home.passes).toBe(true);
    expect(describeVerdict(home)).toMatch(/past the 19.5 kly it needs/);
    const near = evaluateSpatialGate("crystalline_shards_crystalline_shards", { x: 0, y: 0, z: 10000 }, cat)!;
    expect(near.passes).toBe(false);
    expect(describeVerdict(near)).toMatch(/it needs at least 19.5 kly/);
  });

  it("passes the Tubers near the core", () => {
    const v = evaluateSpatialGate("sinuous_tuber_sinuous_tubers_prasinum", cat.core, cat)!;
    expect(v.passes).toBe(true);
    expect(Math.round(v.distanceLy)).toBe(0);
  });

  /**
   * The rule that keeps this honest. Not knowing where a system is must never read as "the species
   * cannot be here" — that is the absence-of-evidence trap the tri-state flags and
   * `predictionUnsupported` both exist to avoid.
   */
  it("returns null for a missing position or a missing catalogue, never a failure", () => {
    expect(evaluateSpatialGate("electricae_electricae_radialem", null, cat)).toBeNull();
    expect(evaluateSpatialGate("electricae_electricae_radialem", undefined, cat)).toBeNull();
    expect(evaluateSpatialGate("electricae_electricae_radialem", HOME, null)).toBeNull();
    // …and a species with no spatial condition has nothing to evaluate either.
    expect(evaluateSpatialGate("bacterium_bacterium_aurasus", HOME, cat)).toBeNull();
  });
});

describe("geometry", () => {
  it("measures a straight line in light years", () => {
    expect(distanceLy({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });

  it("finds the nearest of many, and nothing in an empty catalogue", () => {
    const pts = [
      { n: "far", x: 100, y: 0, z: 0 },
      { n: "near", x: 10, y: 0, z: 0 },
    ];
    expect(nearestPoint({ x: 0, y: 0, z: 0 }, pts)!.point.n).toBe("near");
    expect(nearestPoint({ x: 0, y: 0, z: 0 }, [])).toBeNull();
  });

  it("reads distances at the scale they matter — ly close in, kly far out", () => {
    const near = evaluateSpatialGate("electricae_electricae_radialem", HOME, cat)!;
    expect(describeVerdict(near)).toMatch(/\d+ ly/);
    const far = evaluateSpatialGate("sinuous_tuber_sinuous_tubers_prasinum", HOME, cat)!;
    expect(describeVerdict(far)).toMatch(/kly/);
  });
});

/**
 * Bark Mounds' two radii (owner, 2026-09-26): 93 % of their systems are within 150 ly of a nebula,
 * 100 % within 300. His Flyai Flyuae FM-C b0 grew them at 169 ly while the app offered Anemone.
 */
describe("the Bark Mounds soft band", () => {
  const one = { ...cat, nebulae: [{ n: "Test Nebula", x: 0, y: 0, z: 0 }] };
  const at = (ly: number) => ({ x: ly, y: 0, z: 0 });

  it("passes inside 150 ly, keeps 150–300 ly at half its chance, fails beyond 300", () => {
    expect(evaluateSpatialGate("bark_mounds_bark_mounds", at(100), one)).toMatchObject({ passes: true });
    const band = evaluateSpatialGate("bark_mounds_bark_mounds", at(169), one)!;
    expect(band.passes).toBe(false);
    expect(band.softBand).toEqual({ factor: 0.5, bandLy: 300 });
    expect(describeVerdict(band)).toContain("inside 300 ly");
    const out = evaluateSpatialGate("bark_mounds_bark_mounds", at(350), one)!;
    expect(out.passes).toBe(false);
    expect(out.softBand).toBeUndefined();
  });

  it("gives radialem a band to 200 ly at a tenth of its chance, then unlikely (owner, 2026-10-14)", () => {
    const noRecords = { ...one, planetary: [], records: {} };
    expect(evaluateSpatialGate("electricae_electricae_radialem", at(100), noRecords)).toMatchObject({ passes: true });
    for (const d of [169, 199]) {
      const v = evaluateSpatialGate("electricae_electricae_radialem", at(d), noRecords)!;
      expect(v.passes).toBe(false);
      expect(v.softBand).toEqual({ factor: 0.1, bandLy: 200 });
    }
    for (const d of [201, 350, 2000]) {
      const v = evaluateSpatialGate("electricae_electricae_radialem", at(d), noRecords)!;
      expect(v.passes).toBe(false);
      expect(v.softBand).toBeUndefined();
    }
  });

  it("keeps a band row in the main list with the factor on it", async () => {
    const { demoteFailedSpatialGates } = await import("../src/server/matchSpecies.js");
    const row = { entry: { id: "bark_mounds_bark_mounds" }, reasons: [] } as never;
    const strict = [row];
    const unlikely: never[] = [];
    demoteFailedSpatialGates(strict, unlikely, { systemCoords: at(169) } as never, one);
    expect(unlikely).toHaveLength(0);
    expect(strict[0]).toMatchObject({ presenceFactor: 0.5 });
    demoteFailedSpatialGates(strict, unlikely, { systemCoords: at(350) } as never, one);
    expect(strict).toHaveLength(0);
    expect(unlikely).toHaveLength(1);
  });
});

/*
  Electricae radialem clusters mark nebulae the catalogue lacks (owner, 2026-10-08): within 50 ly of a
  system with 2+ other radialem systems within 100 ly passes; lone finds are planetary nebulae and do
  not count. Braisoo JD-H b43-6: 5.9 kly from the nearest catalogued nebula, 1,130 ly from a lone find.
*/
describe("radialem clusters", () => {
  const RADIALEM = "electricae_electricae_radialem";
  it("ships the clustered systems, not the lone ones", () => {
    expect(cat.records?.radialem?.length).toBeGreaterThan(10000);
    expect(cat.records!.radialem!.some((p) => p.n === "Lasu TG-M b21-8")).toBe(false);
  });

  it("fails far from any nebula and any radialem cluster", () => {
    for (const at of [
      { x: 14055.375, y: 212.21875, z: 34347.53125 }, // Aishaist SA-G b39-0
      { x: 11684.71875, y: -223.75, z: 31860.84375 }, // Braisoo JD-H b43-6
    ]) {
      const v = evaluateSpatialGate(RADIALEM, at, cat)!;
      expect(v.passes).toBe(false);
      expect(v.softBand).toBeUndefined();
      expect(v.record!.distanceLy).toBeGreaterThan(1000);
    }
  });

  it("passes within 50 ly of a cluster the catalogue has no nebula for, not at 60", () => {
    const rec = cat.records!.radialem!.find((p) => (nearestPoint(p, cat.nebulae)?.distanceLy ?? 0) > 3000)!;
    const lone = { ...cat, planetary: [], records: { radialem: [rec] } };
    const near = evaluateSpatialGate(RADIALEM, { x: rec.x + 40, y: rec.y, z: rec.z }, lone)!;
    expect(near.passes).toBe(true);
    expect(describeVerdict(near)).toMatch(/but a Electricae radialem cluster .* is 40 ly — inside its 50 ly rule/);
    expect(evaluateSpatialGate(RADIALEM, { x: rec.x + 60, y: rec.y, z: rec.z }, lone)!.passes).toBe(false);
  });
});

/*
  Planetary nebulae (2026-10-14, docs/perf/radialem-pn.py): outside the old rule radialem grows on every body it can
  up to 90 ly from one and on none past 110 ly. They stay out of `nebulae`, which Bark Mounds read.
*/
describe("radialem and planetary nebulae", () => {
  const RADIALEM = "electricae_electricae_radialem";
  // A planetary nebula far from every catalogued nebula; alone in the catalogue, so nothing else can pass.
  const pn = cat.planetary!.find((p) => (nearestPoint(p, cat.nebulae)?.distanceLy ?? 0) > 1000)!;
  const only = { ...cat, planetary: [pn], records: { radialem: [] } };

  it("ships EDAstro's planetary nebulae apart from the nebulae", () => {
    expect(cat.planetary!.length).toBeGreaterThan(5000);
    expect(cat.nebulae.length).toBe(346);
    expect(cat.sources.planetary).toMatch(/planetary/);
  });

  it("passes within 110 ly of one, not at 120, and says which", () => {
    const near = evaluateSpatialGate(RADIALEM, { x: pn.x + 100, y: pn.y, z: pn.z }, only)!;
    expect(near.passes).toBe(true);
    expect(describeVerdict(near)).toMatch(/but planetary nebula .+ is 100 ly — inside its 110 ly rule/);
    const far = evaluateSpatialGate(RADIALEM, { x: pn.x + 120, y: pn.y, z: pn.z }, only)!;
    expect(far.passes).toBe(false);
    expect(describeVerdict(far)).toMatch(/the nearest planetary nebula \(.+\) is 120 ly \(rule 110 ly\)/);
  });

  it("does not let Bark Mounds pass on one", () => {
    const v = evaluateSpatialGate("bark_mounds_bark_mounds", { x: pn.x + 10, y: pn.y, z: pn.z }, only)!;
    expect(v.passes).toBe(false);
    expect(v.planetary).toBeUndefined();
  });
});
