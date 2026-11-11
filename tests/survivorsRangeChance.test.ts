/**
 * Mutations that survived the suite (review 2026-11-10 §4.1-4.2, plan 2.1): each case here fails when the named
 * comparison or constant changes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NUMERIC_GATE_TOLERANCE, rangeFit, tempBandsOverlapWithinTolerance } from "../src/server/matchSpeciesBands.js";
import { clearChanceRecalibrationCache, recalibratedChance } from "../src/server/chanceRecalibration.js";
import { calibrationLine, clearChanceCalibrationCache } from "../src/server/chanceCalibration.js";
import { fixedPresencePercent } from "../src/server/presenceFloors.js";

describe("the 2 % range rule (matchSpeciesBands.ts)", () => {
  it("counts both edges as in", () => {
    expect(rangeFit(10, 10, 20)).toBe("in");
    expect(rangeFit(20, 10, 20)).toBe("in");
  });

  it("is near up to exactly 2 % past either edge, out beyond", () => {
    expect(NUMERIC_GATE_TOLERANCE).toBe(0.02);
    // Exact in binary: 2 % of 100 is 2.
    expect(rangeFit(98, 100, 200)).toBe("near");
    expect(rangeFit(97.9, 100, 200)).toBe("out");
    expect(rangeFit(102, 0, 100)).toBe("near");
    expect(rangeFit(102.1, 0, 100)).toBe("out");
  });

  it("lets a planet band touch a species band widened by 2 %, not more", () => {
    expect(tempBandsOverlapWithinTolerance({ minK: 204, maxK: 210 }, { lo: 100, hi: 200 })).toBe(true);
    expect(tempBandsOverlapWithinTolerance({ minK: 204.1, maxK: 210 }, { lo: 100, hi: 200 })).toBe(false);
    expect(tempBandsOverlapWithinTolerance({ minK: 80, maxK: 98 }, { lo: 100, hi: 200 })).toBe(true);
    expect(tempBandsOverlapWithinTolerance({ minK: 80, maxK: 97.9 }, { lo: 100, hi: 200 })).toBe(false);
  });
});

describe("the chance maps on a fixture root", () => {
  let root = "";
  const write = (name: string, body: unknown) => {
    root ||= mkdtempSync(path.join(tmpdir(), "edexo-chance-"));
    mkdirSync(path.join(root, "data", "exomastery"), { recursive: true });
    writeFileSync(path.join(root, "data", "exomastery", name), JSON.stringify(body));
  };
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
    clearChanceRecalibrationCache();
    clearChanceCalibrationCache();
  });

  it("recalibration runs through 0 below its first point (chanceRecalibration.ts along)", () => {
    write("chance-recalibration.json", { pooled: [[0.2, 0.1], [0.8, 0.9]], genera: {} });
    // Half the first point's x gives half its y: 10 % shown → 5 %.
    expect(recalibratedChance(root, "Stratum", 10)).toBe(5);
  });

  it("a chance on an inner band edge lands in the upper band (chanceCalibration.ts bandIndex)", () => {
    write("chance-calibration.json", {
      bands: [0, 10, 20, 101],
      minRows: 1,
      fss: { "*": [[100, 5], [100, 15], [100, 50]] },
      dss: { "*": [] },
    });
    expect(calibrationLine(root, "Stratum", 10, false)).toMatch(/^rows said 10-20 % came true 15 %/);
    expect(calibrationLine(root, "Stratum", 9.9, false)).toMatch(/^rows said 0-10 % came true 5 %/);
  });
});

describe("the measured Crystalline Shards presence (presenceFloors.ts)", () => {
  // Counted in the galaxy query database 2026-10-10: 48.6 % of bodies meeting its rules with one signal, 6 % with more.
  it("is 48.6 % on a one-signal body (or one with no count), 6 % on more, none for other species", () => {
    const id = "crystalline_shards_crystalline_shards";
    expect(fixedPresencePercent(id, 1)).toBe(48.6);
    expect(fixedPresencePercent(id, null)).toBe(48.6);
    expect(fixedPresencePercent(id, 2)).toBe(6);
    expect(fixedPresencePercent("stratum_stratum_tectonicas", 1)).toBeNull();
  });
});

describe("the cold volcanic Bacterium shares (measuredOdds.ts)", () => {
  // 300 K is hot: the cold cells are measured on bodies under it.
  it("stop at exactly 300 K", async () => {
    const { measuredOddsNote } = await import("../src/server/measuredOdds.js");
    const tela = { entry: { id: "bacterium_bacterium_tela", genusDataDir: "bacterium", genus: "Bacterium" } } as never;
    const at = (t: number) =>
      measuredOddsNote(tela, { AtmosphereType: "NeonRich", Volcanism: "water geysers volcanism", SurfaceTemperature: t } as never);
    expect(at(299.9)).toMatch(/on cold bodies/);
    expect(at(300) ?? "").not.toMatch(/on cold bodies/);
  });
});
