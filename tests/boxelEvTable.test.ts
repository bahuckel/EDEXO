/**
 * The expedition planner's table (plan 2.2, 2026-10-11): data/boxel/boxel-ev.json, built by
 * docs/perf/boxel_ev.py from the Spansh dump. Every mass code rolled up, the region cells consistent
 * (known ≤ systems, biology ≤ known, genus counts ≤ the DSS'd bodies), rates that can be probabilities.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

type Cell = {
  systems: number;
  known: number;
  bio: number;
  bioBodies: number;
  signals: number;
  dss: number;
  genera: number[];
  boxels?: number;
  sysPerBoxel?: number | null;
};
const doc = JSON.parse(readFileSync(path.join(__dirname, "..", "data", "boxel", "boxel-ev.json"), "utf8")) as {
  builtAt: string;
  genera: string[];
  byMass: Record<string, Cell>;
  cells: Record<string, Cell>;
};

function consistent(c: Cell, genera: number) {
  expect(c.known).toBeLessThanOrEqual(c.systems);
  expect(c.bio).toBeLessThanOrEqual(c.known);
  expect(c.bioBodies).toBeGreaterThanOrEqual(c.bio);
  expect(c.signals).toBeGreaterThanOrEqual(c.bioBodies);
  expect(c.dss).toBeLessThanOrEqual(c.bioBodies);
  expect(c.genera).toHaveLength(genera);
  for (const g of c.genera) expect(g).toBeLessThanOrEqual(c.dss);
}

describe("boxel EV table", () => {
  it("rolls up every mass code with a systems-per-boxel estimate", () => {
    expect(Object.keys(doc.byMass).sort()).toEqual([..."abcdefgh"]);
    for (const c of Object.values(doc.byMass)) {
      consistent(c, doc.genera.length);
      expect(c.sysPerBoxel).toBeGreaterThan(0);
      expect(c.bio / c.known).toBeLessThan(0.5);
    }
  });

  it("has consistent cells for the regions, keyed region|mass code", () => {
    const keys = Object.keys(doc.cells);
    expect(keys.length).toBeGreaterThan(200);
    for (const k of keys) {
      expect(k).toMatch(/^.+\|[a-h]$/);
      consistent(doc.cells[k]!, doc.genera.length);
    }
    // Every mass code in the two most explored regions.
    for (const r of ["Inner Orion Spur", "Inner Scutum-Centaurus Arm"]) for (const m of "abcdefgh") expect(doc.cells[`${r}|${m}`]).toBeTruthy();
  });
});
