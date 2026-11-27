/**
 * The FSS chance correction (owner, 2026-11-02; docs/chance-recal-02112026.md): per genus, the shown chance moved to
 * how often such rows came true. Display only: no row is added or hidden.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectRoot } from "../src/server/paths.js";
import { recalibratedChance, recalibrateChances, softenAfterDss } from "../src/server/chanceRecalibration.js";
import type { SpeciesMatch } from "../src/shared/types.js";

const root = getProjectRoot();
const file = JSON.parse(readFileSync(join(root, "data", "exomastery", "chance-recalibration.json"), "utf8")) as {
  genera: Record<string, unknown>;
  dssSoften: Record<string, number>;
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
    recalibrateChances(fss, false, root);
    expect(fss[0]!.presenceProbabilityPercent).toBeLessThan(60);
    expect(fss[0]!.chanceBeforeRecal).toBe(66);
    expect(fss[1]!.presenceProbabilityPercent).toBe(45);
    expect(fss[1]!.chanceBeforeRecal).toBeUndefined();
    // After a DSS a lone row of its genus has nothing to share with: it stays.
    const dss = [row("Bacterium", 66)];
    recalibrateChances(dss, true, root);
    expect(dss[0]!.presenceProbabilityPercent).toBe(66);
  });
});

const pcts = (rows: SpeciesMatch[]) => rows.map((m) => m.presenceProbabilityPercent);
const sum = (rows: SpeciesMatch[]) => rows.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);

describe("after a DSS, the split inside a genus (owner 2026-11-26)", () => {
  it("softens a genus whose split was too sure, keeping its order and its total", () => {
    // Tubus rows said 70 % after a DSS came true about as often as an even split.
    const rows = [row("Tubus", 70), row("Tubus", 30)];
    recalibrateChances(rows, true, root);
    const [a, b] = pcts(rows) as number[];
    expect(a).toBeLessThan(60);
    expect(a).toBeGreaterThan(b!);
    expect(sum(rows)).toBeCloseTo(100, 0);
    expect(rows[0]!.chanceBeforeRecal).toBe(70);
    expect(rows[1]!.chanceBeforeRecal).toBe(30);
  });

  it("sharpens a genus whose split was too unsure", () => {
    const rows = [row("Sinuous Tuber", 70), row("Sinuous Tuber", 30)];
    recalibrateChances(rows, true, root);
    expect(rows[0]!.presenceProbabilityPercent).toBeGreaterThan(80);
    expect(sum(rows)).toBeCloseTo(100, 0);
  });

  it("leaves a genus with a sure row, demoted rows, genera without a power, and the FSS map alone", () => {
    const sure = [row("Tubus", 99.6), row("Tubus", 0.4)];
    const demoted = [row("Stratum", 70), row("Stratum", 30, true)];
    const unmapped = [row("Electricae", 70), row("Electricae", 30)];
    recalibrateChances([...sure, ...demoted, ...unmapped], true, root);
    expect(pcts(sure)).toEqual([99.6, 0.4]);
    expect(pcts(demoted)).toEqual([70, 30]);
    expect(pcts(unmapped)).toEqual([70, 30]);
    // Before a DSS the per-genus power is not used: a Tubus pair moves by the FSS map, row by row.
    const fss = [row("Tubus", 70), row("Tubus", 30)];
    recalibrateChances(fss, false, root);
    expect(fss.map((m) => m.presenceProbabilityPercent)).toEqual([recalibratedChance(root, "Tubus", 70), recalibratedChance(root, "Tubus", 30)]);
  });

  it("keeps the order inside the genus for any power, and stays between 1 % and 99.5 %", () => {
    for (const t of [0.05, 0.5, 1.5, 3]) {
      const rows = [row("X", 55), row("X", 30), row("X", 10), row("X", 5)];
      softenAfterDss(rows, { x: t });
      const p = pcts(rows) as number[];
      for (let i = 1; i < p.length; i++) expect(p[i - 1]).toBeGreaterThanOrEqual(p[i]!);
      for (const v of p) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99.5);
      }
      // The 1 % minimum can lift a sharpened small row back up: the total gains a point at most here.
      expect(Math.abs(sum(rows) - 100)).toBeLessThanOrEqual(2);
    }
  });

  it("the shipped powers are sane", () => {
    expect(Object.keys(file.dssSoften).length).toBeGreaterThan(5);
    for (const t of Object.values(file.dssSoften)) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(3);
    }
  });
});
