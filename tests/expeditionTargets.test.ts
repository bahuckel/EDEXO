/**
 * The expedition planner's second pass (plan 5.2, owner 2026-10-12): looking for bodies, stars or system
 * worth, and a route from A to B instead of a sphere.
 */
import { describe, expect, it } from "vitest";
import {
  alongSegment,
  boxelsAlong,
  detourLy,
  expectedMatches,
  parseTarget,
  shareAtLeast,
  type FeatureCell,
  type FeatureTable,
} from "../src/server/expeditionTargets.js";

const EDGES = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
const cell: FeatureCell = {
  complete: 1000,
  // 600 under 0.5 M, 200 in 0.5-1, 100 in 1-2, 60 in 2-5, 30 in 5-10, 10 in 10-20
  value: { mean: 1, p90: 2, bins: [600, 200, 100, 60, 30, 10, 0, 0, 0, 0] },
  bodies: {
    elw: { n: 12, with: 10 },
    ww: { n: 130, with: 100 },
    aw: { n: 15, with: 14 },
    hrgg: { n: 3, with: 2 },
    gg: { n: 450, with: 200 },
  },
  stars: {
    "Neutron Star": 50,
    "White Dwarf (DA) Star": 20,
    "White Dwarf (DC) Star": 30,
    "F (White) Star": 900,
  },
};
const table: FeatureTable = {
  builtAt: "2026-10-12",
  valueEdgesM: EDGES,
  kinds: [],
  byMass: { d: cell },
  cells: {},
};

describe("system worth from the histogram", () => {
  it("counts whole bands above and the part of the band it falls in", () => {
    expect(shareAtLeast(cell, EDGES, 0)).toBe(1);
    expect(shareAtLeast(cell, EDGES, 5)).toBeCloseTo((30 + 10) / 1000, 6);
    expect(shareAtLeast(cell, EDGES, 20)).toBe(0);
    // halfway through 5-10 on a log scale: half of its 30, all of 10-20
    const mid = Math.sqrt(5 * 10);
    expect(shareAtLeast(cell, EDGES, mid)).toBeCloseTo((15 + 10) / 1000, 6);
  });
});

describe("what a boxel's unflown systems should hold", () => {
  it("bodies count the systems with one, gas giants count the giants", () => {
    expect(expectedMatches({ kind: "body", body: "elw" }, cell, table, 500)).toBeCloseTo(5, 6);
    expect(expectedMatches({ kind: "body", body: "gg" }, cell, table, 500)).toBeCloseTo(225, 6);
  });
  it("a star type, and a family by its name's start", () => {
    expect(expectedMatches({ kind: "star", star: "Neutron Star" }, cell, table, 100)).toBeCloseTo(5, 6);
    expect(expectedMatches({ kind: "star", star: "White Dwarf" }, cell, table, 100)).toBeCloseTo(5, 6);
  });
  it("worth includes the exobiology, all or nothing per system", () => {
    const scanOnly = expectedMatches({ kind: "value", minM: 10 }, cell, table, 1000);
    expect(scanOnly).toBeCloseTo(10, 6);
    // a fifth of the systems carry 5 M of biology: those need 5 M of scan worth, the rest 10 M
    const withBio = expectedMatches({ kind: "value", minM: 10 }, cell, table, 1000, {
      p: 0.2,
      perBioSystem: 5e6,
    });
    expect(withBio).toBeCloseTo(1000 * (0.8 * 0.01 + 0.2 * 0.04), 6);
    // not every system is worth it when only a few have the biology (it was all of them, spread evenly)
    expect(
      expectedMatches({ kind: "value", minM: 10 }, cell, table, 20, { p: 0.1, perBioSystem: 240e6 }),
    ).toBeLessThan(3);
  });
  it("exobiology itself is scored elsewhere; no cell or no systems is nothing", () => {
    expect(expectedMatches({ kind: "exobio" }, cell, table, 100)).toBe(0);
    expect(expectedMatches({ kind: "body", body: "ww" }, null, table, 100)).toBe(0);
    expect(expectedMatches({ kind: "body", body: "ww" }, cell, table, 0)).toBe(0);
  });
});

describe("the target in the query", () => {
  it("reads each kind, and anything else is exobiology", () => {
    expect(parseTarget("body:elw")).toEqual({ kind: "body", body: "elw" });
    expect(parseTarget("star:Neutron Star")).toEqual({ kind: "star", star: "Neutron Star" });
    expect(parseTarget("value:20")).toEqual({ kind: "value", minM: 20 });
    expect(parseTarget("body:moon")).toEqual({ kind: "exobio" });
    expect(parseTarget(undefined)).toEqual({ kind: "exobio" });
  });
});

describe("a route from A to B", () => {
  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 3000, y: 0, z: 0 };
  it("measures a point against the line", () => {
    expect(alongSegment({ x: 1500, y: 0, z: 100 }, a, b)).toEqual({ offLy: 100, t: 0.5 });
    expect(alongSegment({ x: -200, y: 0, z: 0 }, a, b).t).toBe(0);
    expect(detourLy({ x: 1500, y: 0, z: 0 }, a, b)).toBeCloseTo(0, 6);
    expect(detourLy({ x: 1500, y: 0, z: 2000 }, a, b)).toBeCloseTo(2 * 2500 - 3000, 6);
  });
  it("takes the boxels of a tube round the line, each once, in order along it", () => {
    const { boxels, skipped } = boxelsAlong(a, b, 250, ["e", "f"], null);
    expect(skipped).toEqual([]);
    expect(boxels.length).toBeGreaterThan(0);
    expect(boxels.every((x) => x.offLy <= 250 + (x.cubeLy * Math.sqrt(3)) / 2)).toBe(true);
    const keys = boxels.map((x) => `${x.code}:${x.cell.join(",")}:${x.position}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < boxels.length; i++) expect(boxels[i]!.t).toBeGreaterThanOrEqual(boxels[i - 1]!.t);
    // the far end is covered as well as the near one
    expect(Math.max(...boxels.map((x) => x.t))).toBeGreaterThan(0.85);
  });
  it("leaves out a code that would give too many boxels along a long route", () => {
    const { skipped } = boxelsAlong(a, { x: 20_000, y: 0, z: 0 }, 1000, ["c", "h"], null, 40_000);
    expect(skipped).toContain("c");
    expect(skipped).not.toContain("h");
  });
});

describe("big boxels on a route", () => {
  it("an h-boxel crossing the line counts even when its centre is off it", () => {
    const { boxels } = boxelsAlong({ x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }, 250, ["h"], null);
    expect(boxels.length).toBeGreaterThan(0);
  });
});
