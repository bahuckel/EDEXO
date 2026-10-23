/**
 * The HUD windows' pure geometry (electron/hudGeometry.cjs, out of hudWindows.cjs since audit 2026-10-22): the
 * stack's columns on a screen too short for it, where the next column goes, and a saved free spot.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Area = { x: number; y: number; width: number; height: number };
const geo = require("../electron/hudGeometry.cjs") as {
  HUD_STACK_GAP: number;
  splitIntoColumns: (heights: (number | null)[], room: number, gap?: number) => number[][];
  columnX: (x0: number, c: number, w: number, area: Area, leftwards: boolean, gap?: number) => number;
  freePointFrom: (v: unknown) => { x: number; y: number; bottom: boolean } | null;
};
const huds = require("../electron/hudWindows.cjs") as Record<string, unknown>;

describe("the HUD stack's columns", () => {
  it("keep a stack that fits in one column", () => {
    expect(geo.splitIntoColumns([100, 200, 300], 1000)).toEqual([[0, 1, 2]]);
  });

  it("go on in a second column when the screen is too short, gaps counted", () => {
    const g = geo.HUD_STACK_GAP;
    // 300 + g + 300 fits in 600 + g; the third does not.
    expect(geo.splitIntoColumns([300, 300, 300], 600 + g)).toEqual([[0, 1], [2]]);
    expect(geo.splitIntoColumns([300, 300, 300], 600 + g - 1)).toEqual([[0], [1], [2]]);
  });

  it("give a window taller than the screen a column to itself, and skip a window with no height", () => {
    expect(geo.splitIntoColumns([100, 900, null, 100], 500)).toEqual([[0], [1], [3]]);
  });

  it("place the next column inwards, never off the screen", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    const g = geo.HUD_STACK_GAP;
    expect(geo.columnX(14, 1, 400, area, false)).toBe(14 + 400 + g);
    expect(geo.columnX(1506, 1, 400, area, true)).toBe(1506 - 400 - g);
    expect(geo.columnX(1506, 5, 400, area, true)).toBe(0);
    expect(geo.columnX(1506, 1, 400, area, false)).toBe(1520);
  });
});

describe("a saved free spot", () => {
  it("is rounded, or null when the file was edited into nonsense", () => {
    expect(geo.freePointFrom({ x: 10.4, y: 20.6, bottom: true })).toEqual({ x: 10, y: 21, bottom: true });
    expect(geo.freePointFrom({ x: 1, y: 2 })).toEqual({ x: 1, y: 2, bottom: false });
    for (const v of [null, "1,2", { x: "a", y: 1 }, { x: 1e6, y: 0 }])
      expect(geo.freePointFrom(v)).toBeNull();
  });
});

describe("hudWindows.cjs", () => {
  it("still exports the request coercion it always did", () => {
    const moved = geo as unknown as Record<string, unknown>;
    for (const k of [
      "hudPathFrom",
      "hudWidthFrom",
      "hudHeightFrom",
      "hudSlotKey",
      "HUD_MIN_HEIGHT",
      "HUD_MAX_HEIGHT",
    ]) {
      expect(huds[k], k).toBeDefined();
      expect(huds[k], k).toBe(moved[k]);
    }
    expect(typeof huds.createHudWindows).toBe("function");
  });
});
