/**
 * Catalogue stars in the predicted boxel positions (owner 2026-11-28; src/server/boxelCatalogue.ts,
 * src/shared/stellarPlacement.ts `notRolled`). The cases are real: Spansh positions of the systems, the catalogue
 * star's position from the IGAU list (docs/perf/ggg-study-23112026/forge_catalogue_case.py), measured in
 * docs/boxel-star-placement-23112026.md §3m.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Vec3 } from "../src/shared/boxelOrder.js";
import { boxelFrame, boxelKindFrom, predictBoxelPlacement, predictBoxelPositions } from "../src/shared/stellarPlacement.js";
import { catalogueSystemsIn, parseCatalogueTable } from "../src/server/boxelCatalogue.js";
import {
  boxelPositionSet,
  setBoxelCatalogueSource,
  setBoxelFlownSource,
  setBoxelLookupSource,
  setBoxelSectorSource,
} from "../src/server/boxelPositions.js";

/** Mass code d, normal kind, listed to 147: catalogue stars at 0-6; system 133 needs their cells taken. */
const SEVEN = {
  base: 9588197307n,
  highest: 147,
  catalogue: new Map<number, Vec3>([
    [0, [-4290.21875, 122.09375, -4266.875]],
    [1, [-4292.53125, 80.375, -4276.875]],
    [2, [-4304.84375, 67.65625, -4271.8125]],
    [3, [-4303.90625, 60.15625, -4287.03125]],
    [4, [-4290.34375, 93.59375, -4305.65625]],
    [5, [-4303.40625, 79.75, -4298.5625]],
    [6, [-4300.34375, 103.40625, -4320.875]],
  ]),
  system: 133,
  address: 4579433400251,
  real: [-4285.9375, 89.28125, -4337.40625] as Vec3,
  today: [-4301.40625, 61.6875, -4285.96875] as Vec3,
};
/** Mass code d, listed to 95: one catalogue star at 0; system 1 is placed from it. */
const ONE = {
  base: 10393455027n,
  highest: 95,
  catalogue: new Map<number, Vec3>([[0, [-397.0, -147.59375, 736.25]]]),
  real: [-407.75, -164.03125, 748.8125] as Vec3,
  today: [-407.75, -139.03125, 698.8125] as Vec3,
};

describe("a catalogue star in the placement", () => {
  it("is where the next system starts from: system 1 lands where the game put it", () => {
    const frame = boxelFrame(ONE.base)!;
    expect(predictBoxelPositions(frame, ONE.highest, undefined, "normal")!.get(1)).toEqual(ONE.today);
    const fixed = predictBoxelPositions(frame, ONE.highest, ONE.catalogue, "normal", new Set(ONE.catalogue.keys()));
    expect(fixed!.get(1)).toEqual(ONE.real);
  });

  it("takes its cell: without that, system 133 of a boxel with seven of them is still wrong", () => {
    const frame = boxelFrame(SEVEN.base)!;
    expect(predictBoxelPositions(frame, SEVEN.highest, undefined, "normal")!.get(SEVEN.system)).toEqual(SEVEN.today);
    // Known as plain seen positions (the chain starts from them, the cells stay free): not enough here.
    expect(predictBoxelPositions(frame, SEVEN.highest, SEVEN.catalogue, "normal")!.get(SEVEN.system)).not.toEqual(SEVEN.real);
    const fixed = predictBoxelPositions(frame, SEVEN.highest, SEVEN.catalogue, "normal", new Set(SEVEN.catalogue.keys()));
    expect(fixed!.get(SEVEN.system)).toEqual(SEVEN.real);
  });

  it("gets no prediction and no dice position: its star is not the dice's", () => {
    const frame = boxelFrame(SEVEN.base)!;
    const placed = predictBoxelPlacement(frame, SEVEN.highest, SEVEN.catalogue, "normal", new Set(SEVEN.catalogue.keys()))!;
    for (const n of SEVEN.catalogue.keys()) {
      expect(placed.positions.has(n)).toBe(false);
      expect(placed.after.has(n)).toBe(false);
    }
    expect(placed.positions.has(7)).toBe(true);
    expect(placed.after.has(7)).toBe(true);
  });

  it("tells nothing about the boxel's kind", () => {
    const frame = boxelFrame(SEVEN.base)!;
    expect(boxelKindFrom(frame, SEVEN.catalogue, new Set(SEVEN.catalogue.keys()))).toBeNull();
    // Without the flag the seven would count as checked systems the dice put in the wrong place.
    const read = boxelKindFrom(frame, SEVEN.catalogue);
    expect(read === null || read.hits < read.checked).toBe(true);
  });

  it("is ignored where its position lies outside the boxel", () => {
    const frame = boxelFrame(ONE.base)!;
    const wrong = new Map<number, Vec3>([[0, [0, 0, 0]]]);
    expect(predictBoxelPositions(frame, ONE.highest, wrong, "normal", new Set([0]))!.get(1)).toEqual(ONE.today);
  });
});

describe("the shipped catalogue", () => {
  const table = parseCatalogueTable(readFileSync(path.join(__dirname, "..", "data", "boxel", "boxel-catalogue.bin")));

  it("holds the IGAU list's catalogue systems of mass codes a to g, sorted by boxel", () => {
    expect(table.bases.length).toBe(143105);
    expect(table.meta.source).toMatch(/Intergalactic Astronomical Union/);
  });

  it("finds a boxel's catalogue stars by its system 0's address", () => {
    // FF Aquilae B is Pru Euq GC-W a72-0 (address 5242546966128): mass code a, system 0.
    const found = catalogueSystemsIn(table, 5242546966128n & ((1n << 44n) - 1n));
    expect(found.get(0)).toEqual([-1163.03125, 171.375, 1003.71875]);
    expect(catalogueSystemsIn(table, SEVEN.base)).toEqual(SEVEN.catalogue);
    expect(catalogueSystemsIn(table, 12345n).size).toBe(0);
  });

  it("refuses a file that is not one", () => {
    expect(() => parseCatalogueTable(Buffer.from("not a catalogue file at all"))).toThrow();
  });
});

describe("a boxel's positions with its catalogue stars", () => {
  afterEach(() => {
    setBoxelCatalogueSource(null);
    setBoxelFlownSource(null);
    setBoxelLookupSource(null);
    setBoxelSectorSource(null);
  });
  const prefix = "Test AB-C d";

  it("holds them as seen positions and places the rest from them", () => {
    setBoxelFlownSource((p) => (p === prefix ? [{ n: SEVEN.system, address: SEVEN.address, pos: SEVEN.real }] : []));
    setBoxelCatalogueSource((base) => (base === SEVEN.base ? SEVEN.catalogue : new Map()));
    const s = boxelPositionSet(prefix, SEVEN.highest);
    for (const [n, p] of SEVEN.catalogue) {
      expect(s.positions.get(n)).toEqual(p);
      expect(s.predicted.has(n)).toBe(false);
      expect(s.after?.has(n) ?? false).toBe(false);
    }
    // System 133 rolled "anywhere", which lands the same in either kind: the kind comes from the boxel's place (far
    // from the galaxy's centre: normal), and the catalogue stars are not taken as evidence either way.
    expect(s.checked).toBe(0);
    expect(s.predicted.has(7)).toBe(true);
    expect(s.positions.get(SEVEN.system)).toEqual(SEVEN.real);
  });

  it("leaves out a catalogue star past the number asked for", () => {
    setBoxelFlownSource((p) => (p === prefix ? [{ n: SEVEN.system, address: SEVEN.address, pos: SEVEN.real }] : []));
    setBoxelCatalogueSource((base) => (base === SEVEN.base ? SEVEN.catalogue : new Map()));
    const s = boxelPositionSet(prefix, 3);
    expect(s.positions.has(4)).toBe(false);
    expect(s.positions.get(3)).toEqual(SEVEN.catalogue.get(3));
  });
});
