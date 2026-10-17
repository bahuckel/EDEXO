/**
 * The "why this chance" calibration line (plan-17102026-1.2.19 F3): how often rows at this chance came true on the
 * EDDN year, per genus where the band holds enough rows, else all genera; before and after a DSS apart.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calibrationLine, clearChanceCalibrationCache } from "../src/server/chanceCalibration.js";
import { getProjectRoot } from "../src/server/paths.js";

function rootWith(doc: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), "edexo-calib-"));
  mkdirSync(path.join(root, "data", "exomastery"), { recursive: true });
  writeFileSync(path.join(root, "data", "exomastery", "chance-calibration.json"), JSON.stringify(doc));
  return root;
}

const doc = {
  bands: [0, 50, 100],
  minRows: 30,
  fss: {
    "*": [
      [1000, 100, 10],
      [2000, 1800, 90],
    ],
    stratum: [
      [40, 10, 20],
      [10, 9, 95],
    ],
  },
  dss: { "*": [[5, 1, 10], [500, 300, 70]] },
};

afterEach(() => clearChanceCalibrationCache());

describe("chance calibration line", () => {
  it("uses the genus' own band when it holds enough rows", () => {
    expect(calibrationLine(rootWith(doc), "Stratum", 30, false)).toBe(
      "rows said 0-50 % came true 25 % of the time (40 Stratum rows, EDDN year)",
    );
  });

  it("falls back to all genera when the genus' band is thin, and 100 % lands in the last band", () => {
    expect(calibrationLine(rootWith(doc), "Stratum", 100, false)).toBe(
      "rows said 50-100 % came true 90 % of the time (2,000 rows of all genera, EDDN year)",
    );
  });

  it("reads the DSS table after a DSS, and says nothing where even all genera are too few", () => {
    const root = rootWith(doc);
    expect(calibrationLine(root, "Tubus", 70, true)).toMatch(/after a DSS came true 60 %/);
    clearChanceCalibrationCache();
    expect(calibrationLine(root, "Tubus", 5, true)).toBeNull();
  });

  it("says nothing without a chance or without the table", () => {
    expect(calibrationLine(rootWith(doc), "Stratum", null, false)).toBeNull();
    clearChanceCalibrationCache();
    expect(calibrationLine(mkdtempSync(path.join(tmpdir(), "edexo-calib-none-")), "Stratum", 40, false)).toBeNull();
  });

  it("the shipped table answers for a common genus before a DSS", () => {
    expect(calibrationLine(getProjectRoot(), "Bacterium", 95, false)).toMatch(/^rows said 90-100 % came true \d+ %/);
  });
});
