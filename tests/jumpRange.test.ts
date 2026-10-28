/**
 * The full jump range as flown (shared/jumpRange.ts; owner, 2026-10-08): boosted jumps and
 * economical-route hops left out; a refit scales them, each ship keeps its own.
 */
import { describe, expect, it } from "vitest";
import {
  emptyJumpRange,
  fullJumpRange,
  hydrateJumpRangeOthers,
  jumpRangeJump,
  jumpRangeLoadout,
  onEconomicalRoute,
} from "../src/shared/jumpRange.js";

const fly = (st: ReturnType<typeof emptyJumpRange>, ...d: number[]) =>
  d.forEach((x) => jumpRangeJump(st, x, undefined));

describe("the full jump range as flown", () => {
  it("is the average of the longest 30 % of the jumps, not of all of them", () => {
    const st = emptyJumpRange();
    jumpRangeLoadout(st, 7, 71.63);
    fly(st, 66.4, 56.6, 63.5);
    expect(fullJumpRange(st)).toBe(66.4);
    // Ten jumps, none boosted: the top 30 % (67.3, 66.5, 66.4) averaged.
    fly(st, 66.5, 63.8, 67.3, 62.6, 65.1, 49.8, 38.8);
    expect(fullJumpRange(st)).toBeCloseTo(66.733, 3);
  });

  it("leaves out a neutron or white dwarf boost and an injection", () => {
    const st = emptyJumpRange();
    fly(st, 66, 67, 68);
    jumpRangeJump(st, 260, 4);
    jumpRangeJump(st, 100, 2);
    expect(fullJumpRange(st)).toBe(68);
  });

  it("keeps the full range through an economical route, however long", () => {
    const st = emptyJumpRange();
    fly(st, 66, 67, 68, 67);
    for (let i = 0; i < 60; i++) fly(st, 3 + (i % 3));
    expect(fullJumpRange(st)).toBe(68);
    expect(onEconomicalRoute(st)).toBe(true);
    fly(st, 66);
    expect(onEconomicalRoute(st)).toBe(false);
  });

  it("works at any range: 23-25 ly the same way", () => {
    const st = emptyJumpRange();
    fly(st, 23, 24, 25, 4, 5, 24);
    expect(fullJumpRange(st)).toBe(25);
  });

  it("scales the jumps flown by a refit that moves the loadout's own range: no jumps needed first", () => {
    const st = emptyJumpRange();
    jumpRangeLoadout(st, 7, 71.63);
    fly(st, 66, 67, 68);
    jumpRangeLoadout(st, 7, 71.7); // the same ship, fuel or a small change: kept as is
    expect(fullJumpRange(st)).toBe(68);
    jumpRangeLoadout(st, 7, 60.1); // a refit: 68 × 60.1 / 71.7
    expect(fullJumpRange(st)).toBeCloseTo((68 * 60.1) / 71.7, 6);
  });

  it("keeps each ship's jumps while another is flown, and takes them back when it returns", () => {
    const st = emptyJumpRange();
    jumpRangeLoadout(st, 7, 71.63);
    fly(st, 66, 67, 68);
    jumpRangeLoadout(st, 9, 30); // another ship: nothing flown in it yet
    expect(fullJumpRange(st)).toBeNull();
    fly(st, 27, 28, 29);
    expect(fullJumpRange(st)).toBe(29);
    jumpRangeLoadout(st, 7, 71.63); // back
    expect(fullJumpRange(st)).toBe(68);
    jumpRangeLoadout(st, 9, 33); // back to the other, refitted meanwhile: scaled
    expect(fullJumpRange(st)).toBeCloseTo((29 * 33) / 30, 6);
  });

  it("forgets the ships left longest ago, not the lowest ShipIDs (review 2026-10-28)", () => {
    const st = emptyJumpRange();
    // Ships 40 … 52 flown in turn, then ship 3, then ship 60: fourteen left behind, twelve kept.
    for (const id of [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 3, 60]) {
      jumpRangeLoadout(st, id, 50);
      fly(st, id, id, id);
    }
    jumpRangeLoadout(st, 3, 50);
    expect(fullJumpRange(st)).toBe(3); // left recently: kept (the lowest ShipID went first before)
    jumpRangeLoadout(st, 40, 50);
    expect(fullJumpRange(st)).toBeNull(); // left first: forgotten
  });

  it("reads saved ships safely: bad entries dropped, old numeric keys taken", () => {
    const others = hydrateJumpRangeOthers({
      "7": { loadoutLy: 60, long: [55, 55, 55, "x", -1], recent: [50] },
      s9: { long: {} },
      s10: null,
    });
    expect(others).toEqual({ s7: { loadoutLy: 60, long: [55, 55, 55], recent: [50] } });
    const st = { ...emptyJumpRange(), shipId: 1, others };
    jumpRangeLoadout(st, 7, 66); // back to 7, refitted: 55 × 66 / 60
    expect(fullJumpRange(st)).toBeCloseTo((55 * 66) / 60, 6);
  });
});
