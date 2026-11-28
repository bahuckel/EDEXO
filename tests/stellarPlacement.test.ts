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
  boxelKindFrom,
  likelyBoxelKind,
  NORMAL_FROM_LY,
  PLACEMENT_EXACT_KNOWN_KIND,
  placementKnown,
  SCATTER_WITHIN_LY,
  predictBoxelPositions,
  systemRolls,
  wang64to32,
  type BoxelKind,
} from "../src/shared/stellarPlacement.js";
import {
  boxelPositionSet,
  PREDICT_MAX_NUMBER,
  setBoxelFlownSource,
  setBoxelLookupSource,
  setBoxelSectorSource,
  setBoxelSeenEverywhereSource,
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
  kinds: { code: MassCode; kind: BoxelKind; systems: Row[] }[];
};
const real = (r: Row): Vec3 => [r[2], r[3], r[4]];
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

  it("does not predict mass code h, nor a place that does not exist", () => {
    expect(placementKnown("h")).toBe(false);
    expect(placementKnown("f")).toBe(true);
    expect(predictBoxelPositions({ ...boxelFrame(golden.eembaids[0]![0])!, code: "h" }, 5)).toBeNull();
    expect(boxelKindFrom({ ...boxelFrame(golden.eembaids[0]![0])!, code: "h" }, new Map([[0, [0, 0, 0]]]))).toBeNull();
    // A g boxel has two places per axis in its sector.
    expect(boxelFrameAt("g", [10, 10, 10], 2)).toBeNull();
    expect(boxelFrameAt("g", [200, 10, 10], 0)).toBeNull();
  });

  it("a known position sets the chain right for the system after it", () => {
    const [missed, next] = golden.repair.systems;
    const frame = boxelFrame(missed![0])!;
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

describe("the two kinds of boxel", () => {
  for (const b of golden.kinds) {
    it(`places a ${b.kind} mass code ${b.code} boxel, and reads its kind from its real positions`, () => {
      const frame = boxelFrame(b.systems[0]![0])!;
      const got = predictBoxelPositions(frame, b.systems.length - 1, undefined, b.kind)!;
      for (const r of b.systems) expect(got.get(numberOf(r[1]))).toEqual(real(r));
      // The other kind misses at least three of them.
      const other = predictBoxelPositions(frame, b.systems.length - 1, undefined, b.kind === "normal" ? "scatter" : "normal")!;
      expect(b.systems.filter((r) => other.get(numberOf(r[1]))!.every((v, i) => v === real(r)[i])).length).toBeLessThan(
        b.systems.length - 2,
      );
      const known = new Map(b.systems.map((r) => [numberOf(r[1]), real(r)] as const));
      expect(boxelKindFrom(frame, known)).toEqual({ kind: b.kind, checked: known.size, hits: known.size });
    });
  }

  it("one real position tells the kind of an a or b boxel: the cell is half the size", () => {
    for (const b of golden.kinds.filter((k) => k.code === "a" || k.code === "b")) {
      const frame = boxelFrame(b.systems[0]![0])!;
      for (const r of b.systems.slice(0, 4))
        expect(boxelKindFrom(frame, new Map([[numberOf(r[1]), real(r)]]))?.kind).toBe("scatter");
    }
  });

  it("tells nothing without a real position, or from one outside the boxel", () => {
    const frame = boxelFrame(golden.kinds[0]!.systems[0]![0])!;
    expect(boxelKindFrom(frame, new Map())).toBeNull();
    expect(boxelKindFrom(frame, new Map([[0, [1, 2, 3]]]))).toBeNull();
  });

  it("guesses the likelier kind of a boxel by how crowded it is, or nothing near a coin toss", () => {
    expect(likelyBoxelKind("g", 900)).toEqual({ kind: "normal", exact: PLACEMENT_EXACT_KNOWN_KIND });
    expect(likelyBoxelKind("d", 10)).toEqual({ kind: "normal", exact: PLACEMENT_EXACT_KNOWN_KIND });
    expect(likelyBoxelKind("f", 300)?.kind).toBe("scatter");
    // c, 128 to 255: 39 % scatter; a wrong guess still leaves half of them right.
    expect(likelyBoxelKind("c", 200)!.exact).toBeCloseTo(0.99 * (0.61 + 0.195), 6);
    // a and b have another grid when wrong: nothing right. 54.5 % and 45.5 % are too close to a coin toss.
    expect(likelyBoxelKind("b", 200)).toBeNull();
    expect(likelyBoxelKind("a", 50)).toBeNull();
    expect(likelyBoxelKind("b", 20)!.exact).toBeCloseTo(0.99 * 0.965, 6);
    expect(likelyBoxelKind("h", 5)).toBeNull();
    expect(likelyBoxelKind("a", 600)).toBeNull();
    expect(likelyBoxelKind("c", 1001)).toBeNull();
    expect(likelyBoxelKind("c", -1)).toBeNull();
  });

  it("knows the kind from where the boxel is: normal far from the galaxy's centre, scatter close to it", () => {
    const sure = (kind: BoxelKind) => ({ kind, exact: PLACEMENT_EXACT_KNOWN_KIND });
    // Around Sol, 25,900 ly out: a crowded b boxel is no coin toss there.
    expect(likelyBoxelKind("b", 200, [0, 0, 0])).toEqual(sure("normal"));
    expect(likelyBoxelKind("a", 50, [120, -40, 310])).toEqual(sure("normal"));
    expect(likelyBoxelKind("f", 300, [0, 0, 0])).toEqual(sure("normal"));
    // At the centre.
    expect(likelyBoxelKind("b", 5, [25, -20, 25900])).toEqual(sure("scatter"));
    expect(likelyBoxelKind("d", 5, [1000, 300, 23000])).toEqual(sure("scatter"));
    expect(likelyBoxelKind("g", 5, [25, -20, 25900])).toEqual(sure("normal"));
    // The limits themselves, in the plane: 22,000 ly out and 4,000 ly out.
    expect(likelyBoxelKind("b", 200, [25.21875, 0, 25899.96875 - NORMAL_FROM_LY])).toEqual(sure("normal"));
    expect(likelyBoxelKind("b", 200, [25.21875, 0, 25899.96875 - NORMAL_FROM_LY + 1])).toBeNull();
    expect(likelyBoxelKind("b", 5, [25.21875, 0, 25899.96875 - SCATTER_WITHIN_LY + 1])).toEqual(sure("scatter"));
    expect(likelyBoxelKind("b", 5, [25.21875, 0, 25899.96875 - SCATTER_WITHIN_LY])!.kind).toBe("normal");
    // Between the two the crowding decides, as with no place given; height over the plane does not count.
    expect(likelyBoxelKind("c", 200, [25, 3000, 25900 - 12000])).toEqual(likelyBoxelKind("c", 200));
    expect(likelyBoxelKind("h", 5, [0, 0, 0])).toBeNull();
    expect(likelyBoxelKind("b", 2000, [0, 0, 0])).toEqual(sure("normal"));
  });
});

describe("a boxel's positions for the shortest order", () => {
  beforeEach(() => {
    setBoxelLookupSource(null);
    setBoxelSectorSource(null);
    setBoxelFlownSource(null);
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
    expect(s.exact).toBe(PLACEMENT_EXACT_KNOWN_KIND);
    expect(s.checked).toBe(0);
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

  it("reads a scatter boxel's kind from where he is, and guesses without", () => {
    const b = golden.kinds.find((k) => k.code === "b")!;
    const frame = boxelFrame(b.systems[0]![0])!;
    const name = b.systems[0]![1];
    const boxel = name.slice(0, name.lastIndexOf("-") + 1);
    const sector = [0, 1, 2].map((i) => Math.floor((frame.origin[i]! + [49985, 40985, 24105][i]!) / 1280)) as [number, number, number];
    setBoxelSectorSource((s) => (boxel.startsWith(`${s} `) ? sector : null));
    const last = b.systems.length - 1;
    // Nothing seen: a b boxel this small is nearly always normal, and here that guess is wrong.
    const blind = boxelPositionSet(boxel, last);
    expect(blind.checked).toBe(0);
    expect(blind.exact).toBeCloseTo(0.99 * 0.995, 6);
    expect(blind.positions.get(3)).not.toEqual(real(b.systems[3]!));
    // In its first system: one real position, and every other system is where the game put it.
    const there = boxelPositionSet(boxel, last, { name, pos: real(b.systems[0]!) });
    expect(there.checked).toBe(1);
    expect(there.exact).toBe(PLACEMENT_EXACT_KNOWN_KIND);
    expect(there.predicted.has(0)).toBe(false);
    for (const r of b.systems) expect(there.positions.get(numberOf(r[1]))).toEqual(real(r));
    // Somewhere else entirely: where he is says nothing about this boxel.
    expect(boxelPositionSet(boxel, last, { name: "Sol", pos: [0, 0, 0] }).checked).toBe(0);
  });

  it("takes the systems he has flown as seen positions: they place the boxel and tell its kind", () => {
    const b = golden.kinds.find((k) => k.code === "b")!;
    const name = b.systems[0]![1];
    const boxel = name.slice(0, name.lastIndexOf("-") + 1);
    const last = b.systems.length - 1;
    // No sector table, no look-up, not there now: nothing to stand on.
    expect(boxelPositionSet(boxel, last).predicted.size).toBe(0);
    const flown = b.systems.slice(0, 2).map((r) => ({ n: numberOf(r[1]), address: Number(r[0]), pos: real(r) }));
    setBoxelFlownSource((prefix) => (prefix === boxel ? flown : []));
    const s = boxelPositionSet(boxel, last);
    expect(s.checked).toBe(2);
    expect(s.exact).toBe(PLACEMENT_EXACT_KNOWN_KIND);
    expect(s.frame?.code).toBe("b");
    expect([...s.predicted].some((n) => flown.some((f) => f.n === n))).toBe(false);
    for (const r of b.systems) expect(s.positions.get(numberOf(r[1]))).toEqual(real(r));
    // Where each system's dice stand after its placement, for the star's own rolls: every number, once the kind is known.
    expect(s.after?.size).toBe(last + 1);
    expect(boxelPositionSet("Some Other AA-A b", last).predicted.size).toBe(0);
  });

  it("gives the dice's place only when the boxel's kind is known", () => {
    const b = golden.kinds.find((k) => k.code === "b")!;
    const frame = boxelFrame(b.systems[0]![0])!;
    const name = b.systems[0]![1];
    const boxel = name.slice(0, name.lastIndexOf("-") + 1);
    const sector = [0, 1, 2].map((i) => Math.floor((frame.origin[i]! + [49985, 40985, 24105][i]!) / 1280)) as [number, number, number];
    setBoxelSectorSource((s) => (boxel.startsWith(`${s} `) ? sector : null));
    // A guessed kind: positions are shown with their lower share, the stars are not predicted from it.
    const blind = boxelPositionSet(boxel, b.systems.length - 1);
    expect(blind.predicted.size).toBeGreaterThan(0);
    expect(blind.exact).toBeLessThan(PLACEMENT_EXACT_KNOWN_KIND);
    expect(blind.after).toBeNull();
  });

  it("needs no guess around Sol, however crowded the boxel", () => {
    // The sector that holds Sol: 22,000 ly and more from the galaxy's centre every boxel is normal.
    setBoxelSectorSource((s) => (s === "Wregoe" ? [39, 32, 18] : null));
    const s = boxelPositionSet("Wregoe AA-A b", 200);
    expect(s.predicted.size).toBe(201);
    expect(s.exact).toBe(PLACEMENT_EXACT_KNOWN_KIND);
    expect(s.checked).toBe(0);
  });

  it("takes an unvisited boxel's kind from the boxels of its sector he has flown (owner 2026-11-28)", () => {
    // The real scatter b boxel of the golden file is the one flown; its neighbour in the same sector has no position
    // of its own. Without the flown boxel the neighbour's kind is a crowding guess (normal: wrong here, §3m).
    const b = golden.kinds.find((k) => k.code === "b" && k.kind === "scatter")!;
    const frame = boxelFrame(b.systems[0]![0])!;
    const parsed = parseBoxel(b.systems[0]![1])!;
    const sector = [0, 1, 2].map((i) => Math.floor((frame.origin[i]! + [49985, 40985, 24105][i]!) / 1280)) as [number, number, number];
    setBoxelSectorSource((s) => (s === parsed.sector ? sector : null));
    const target = `${parsed.sector} ${parsed.prefix.endsWith("AA-A b") ? "BA-A" : "AA-A"} b`;
    expect(target).not.toBe(parsed.prefix);
    // Listed to 200 the crowding guess is a coin toss (45.5 % of such b boxels are scatter): nothing predicted.
    expect(boxelPositionSet(target, 200).predicted.size).toBe(0);
    const flown = b.systems.map((r) => ({ n: numberOf(r[1]), address: Number(r[0]), pos: real(r) }));
    setBoxelSeenEverywhereSource(() => ({ size: flown.length, systems: flown }));
    const s = boxelPositionSet(target, 200);
    expect(s.neighbours).toBe(1);
    expect(s.checked).toBe(0);
    // One boxel voting, b: right for 82.7 %; a wrong kind leaves every system off, so that share alone.
    expect(s.exact).toBeCloseTo(0.99 * 0.827, 6);
    const scatter = predictBoxelPositions(s.frame!, 200, undefined, "scatter")!;
    for (let n = 0; n <= 200; n++) expect(s.positions.get(n)).toEqual(scatter.get(n));
    // Listed to 10 the crowding guess (normal for 99.5 % of such b boxels) beats one vote: it stays.
    const sparse = boxelPositionSet(target, 10);
    expect(sparse.neighbours).toBe(0);
    expect(sparse.exact).toBeCloseTo(0.99 * 0.995, 6);
    // The flown boxel itself keeps reading its kind from its own positions.
    setBoxelFlownSource((p) => (p === parsed.prefix ? flown : []));
    expect(boxelPositionSet(parsed.prefix, b.systems.length - 1).neighbours).toBe(0);
    setBoxelSeenEverywhereSource(null);
  });

  it("predicts nothing where the kind would be a coin toss", () => {
    const b = golden.kinds.find((k) => k.code === "b")!;
    const frame = boxelFrame(b.systems[0]![0])!;
    const name = b.systems[0]![1];
    const boxel = name.slice(0, name.lastIndexOf("-") + 1);
    const sector = [0, 1, 2].map((i) => Math.floor((frame.origin[i]! + [49985, 40985, 24105][i]!) / 1280)) as [number, number, number];
    setBoxelSectorSource((s) => (boxel.startsWith(`${s} `) ? sector : null));
    // Listed to 200: 45.5 % of such b boxels are scatter.
    expect(boxelPositionSet(boxel, 200).predicted.size).toBe(0);
    // One real position settles it, however crowded.
    const there = boxelPositionSet(boxel, 200, { name, pos: real(b.systems[0]!) });
    expect(there.predicted.size).toBe(200);
    expect(there.exact).toBe(PLACEMENT_EXACT_KNOWN_KIND);
  });
});
