/**
 * Predicted system positions (src/shared/stellarPlacement.ts; owner, 2026-11-24: step A of
 * docs/plan-24112026-star-predictor.md). The golden file holds real Spansh systems: the test is "the game put it
 * there", not "the code agrees with itself".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { boxelPositionOf, type MassCode } from "../src/shared/boxelAdvice.js";
import { parseBoxel } from "../src/shared/boxel.js";
import type { Vec3 } from "../src/shared/boxelOrder.js";
import {
  boxelFrame,
  boxelFrameAt,
  PLACEMENT_EXACT,
  predictBoxelPositions,
  systemRolls,
  wang64to32,
} from "../src/shared/stellarPlacement.js";
import {
  boxelPositionSet,
  PREDICT_MAX_NUMBER,
  setBoxelLookupSource,
  setBoxelSectorSource,
} from "../src/server/boxelPositions.js";
import type { BoxelLookupRecord } from "../src/server/boxelLookup.js";

type Row = [address: string, name: string, x: number, y: number, z: number];
const golden = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "stellar-placement-golden.json"), "utf8"),
) as {
  rolls: { address: string; first: number[] };
  boxels: { code: MassCode; systems: Row[] }[];
  eembaids: Row[];
  repair: { code: MassCode; missed: number; systems: Row[] };
};
const numberOf = (name: string) => parseBoxel(name)!.index!;

describe("a system's own dice", () => {
  it("hash a 64-bit address to 32 bits and roll MINSTD from it", () => {
    expect(wang64to32(0n)).toBe(wang64to32(1n << 64n));
    expect(systemRolls(BigInt(golden.rolls.address), 8)).toEqual(golden.rolls.first);
    for (const r of systemRolls(BigInt(golden.rolls.address))) expect(r > 0 && r < 2147483647).toBe(true);
  });
});

describe("predicted positions against Spansh", () => {
  for (const b of golden.boxels) {
    it(`puts the first ${b.systems.length} systems of a mass code ${b.code} boxel where the game did`, () => {
      const frame = boxelFrame(b.systems[0]![0])!;
      expect(frame.code).toBe(b.code);
      const got = predictBoxelPositions(frame, b.systems.length - 1)!;
      for (const [address, name, x, y, z] of b.systems) {
        // Every system's address gives the same boxel.
        expect(boxelFrame(address)!.base).toBe(frame.base);
        expect(got.get(numberOf(name))).toEqual([x, y, z]);
      }
    });
  }

  it("places his Eembaids EG-Y g boxel from its name alone", () => {
    // The sector's cell on the 1,280 ly grid, as data/boxel/sector-names.json has it.
    const cells = JSON.parse(
      readFileSync(path.join(__dirname, "..", "data", "boxel", "sector-names.json"), "utf8"),
    ) as { cells: [number, number, number, string, number][] };
    const cell = cells.cells.find((c) => c[3] === "Eembaids")!;
    const frame = boxelFrameAt("g", [cell[0], cell[1], cell[2]], boxelPositionOf("EG-Y g")!)!;
    expect(frame.base).toBe(boxelFrame(golden.eembaids[0]![0])!.base);
    const got = predictBoxelPositions(frame, 21)!;
    expect(golden.eembaids).toHaveLength(22);
    for (const [, name, x, y, z] of golden.eembaids) expect(got.get(numberOf(name))).toEqual([x, y, z]);
  });

  it("does not predict mass codes f and h, nor a place that does not exist", () => {
    expect(PLACEMENT_EXACT.f).toBeNull();
    expect(PLACEMENT_EXACT.h).toBeNull();
    expect(predictBoxelPositions({ ...boxelFrame(golden.eembaids[0]![0])!, code: "h" }, 5)).toBeNull();
    expect(predictBoxelPositions({ ...boxelFrame(golden.eembaids[0]![0])!, code: "f" }, 5)).toBeNull();
    // A g boxel has two places per axis in its sector.
    expect(boxelFrameAt("g", [10, 10, 10], 2)).toBeNull();
    expect(boxelFrameAt("g", [200, 10, 10], 0)).toBeNull();
  });

  it("a known position sets the chain right for the system after it", () => {
    const [missed, next] = golden.repair.systems;
    const frame = boxelFrame(missed![0])!;
    const real = (r: Row): Vec3 => [r[2], r[3], r[4]];
    const n = golden.repair.missed;
    const blind = predictBoxelPositions(frame, n + 1)!;
    // With nothing known both land in another cell: the miss the measured share speaks of.
    expect(blind.get(n)).not.toEqual(real(missed!));
    expect(blind.get(n + 1)).not.toEqual(real(next!));
    const seen = predictBoxelPositions(frame, n + 1, new Map([[n, real(missed!)]]))!;
    expect(seen.get(n + 1)).toEqual(real(next!));
    // A miss keeps its place inside the cell: 5 ly cells at mass code d.
    for (let i = 0; i < 3; i++) expect(Math.abs((blind.get(n)![i]! - real(missed!)[i]!) * 32) % 160).toBe(0);
  });
});

describe("a boxel's positions for the shortest order", () => {
  beforeEach(() => {
    setBoxelLookupSource(null);
    setBoxelSectorSource(null);
  });
  const g = golden.eembaids;
  const prefix = "Eembaids EG-Y g";

  it("has none to predict without the boxel's place or an address", () => {
    const s = boxelPositionSet(prefix, 21);
    expect(s.positions.size).toBe(0);
    expect(s.exact).toBeNull();
  });

  it("predicts from the sector's cell, and only up to the number asked for", () => {
    const frame = boxelFrame(g[0]![0])!;
    const sector = [Math.floor((frame.origin[0] + 49985) / 1280), Math.floor((frame.origin[1] + 40985) / 1280), Math.floor((frame.origin[2] + 24105) / 1280)] as const;
    setBoxelSectorSource((name) => (name === "Eembaids" ? sector : null));
    expect(boxelPositionSet(prefix).positions.size).toBe(0);
    const s = boxelPositionSet(prefix, 21);
    expect(s.positions.size).toBe(22);
    expect(s.predicted.size).toBe(22);
    expect(s.exact).toBe(1);
    for (const [, name, x, y, z] of g) expect(s.positions.get(numberOf(name))).toEqual([x, y, z]);
    expect(boxelPositionSet("Nowhere EG-Y g", 21).positions.size).toBe(0);
    // A boxel listed past the limit keeps to seen positions: the order's cost grows with the square.
    expect(boxelPositionSet(prefix, PREDICT_MAX_NUMBER).positions.size).toBe(PREDICT_MAX_NUMBER + 1);
    expect(boxelPositionSet(prefix, PREDICT_MAX_NUMBER + 1).positions.size).toBe(0);
  });

  it("a looked-up position wins over a prediction, and its address places the boxel", () => {
    const record = {
      prefix,
      fetchedAt: new Date().toISOString(),
      systems: { 3: { id64: Number(g[3]![0]), pos: [1, 2, 3] } },
    } as unknown as BoxelLookupRecord;
    setBoxelLookupSource((p) => (p === prefix ? record : null));
    const s = boxelPositionSet(prefix, 5);
    expect(s.positions.get(3)).toEqual([1, 2, 3]);
    expect(s.predicted.has(3)).toBe(false);
    expect([...s.predicted].sort()).toEqual([0, 1, 2, 4, 5]);
    expect(s.positions.get(0)).toEqual([g[0]![2], g[0]![3], g[0]![4]]);
  });
});
