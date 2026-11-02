/**
 * The FSS chance correction (owner, 2026-11-02; docs/chance-recal-02112026.md): per genus, the shown chance moved to
 * how often such rows came true. Display only: no row is added or hidden.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectRoot } from "../src/server/paths.js";
import { recalibratedChance, recalibrateFssChances } from "../src/server/chanceRecalibration.js";
import type { SpeciesMatch } from "../src/shared/types.js";

const root = getProjectRoot();
const file = JSON.parse(readFileSync(join(root, "data", "exomastery", "chance-recalibration.json"), "utf8")) as {
  genera: Record<string, unknown>;
};

const row = (genus: string, pct: number, unlikely = false) =>
  ({ entry: { id: `${genus}-x`, genus }, presenceProbabilityPercent: pct, unlikely }) as unknown as SpeciesMatch;

describe("the FSS chance correction", () => {
  it("moves the genera that leaned the wrong way, each its own way", () => {
    // Bacterium rows said 66 % came true about 50 %; Tussock rows said 75 % came true 96 %.
    expect(recalibratedChance(root, "Bacterium", 66)).toBeLessThan(60);
    expect(recalibratedChance(root, "Tussock", 75)).toBeGreaterThan(85);
    expect(recalibratedChance(root, "Stratum", 25)).toBeGreaterThan(28);
  });

  it("is monotone inside every genus and stays between 1 % and 99.5 %, sure rows untouched", () => {
    for (const g of [...Object.keys(file.genera), "a genus without its own map"]) {
      let prev = -1;
      for (let p = 0.5; p < 99.5; p += 0.5) {
        const v = recalibratedChance(root, g, p);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99.5);
        prev = v;
      }
      expect(recalibratedChance(root, g, 99.5)).toBe(99.5);
      expect(recalibratedChance(root, g, 100)).toBe(100);
    }
  });

  it("corrects shown rows before a DSS only, keeps the chance before, leaves demoted rows alone", () => {
    const fss = [row("Bacterium", 66), row("Concha", 45, true)];
    recalibrateFssChances(fss, false, root);
    expect(fss[0]!.presenceProbabilityPercent).toBeLessThan(60);
    expect(fss[0]!.chanceBeforeRecal).toBe(66);
    expect(fss[1]!.presenceProbabilityPercent).toBe(45);
    expect(fss[1]!.chanceBeforeRecal).toBeUndefined();
    const dss = [row("Bacterium", 66)];
    recalibrateFssChances(dss, true, root);
    expect(dss[0]!.presenceProbabilityPercent).toBe(66);
  });
});
