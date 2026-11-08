/**
 * The Scan route's distance reader (plan 1.3.8): the target's distance read off the HUD (shared/hudTargetDistance.ts),
 * the game's number rules for its comma and point, the server's fix from it (server/shipInSystem.ts), the page's
 * steadiness check, and the marker window opening for the reader alone (electron/aimWindow.cjs). The frames are drawn
 * with a plain 5 x 7 font and a glyph table made from it, so the logic is tested without a picture of the game; the
 * real table (hudDistanceGlyphs.ts) was measured on the owner's 170 F10 shots (scripts/build-hud-distance-glyphs.ts
 * --check: 167 right, 3 not sure, 0 wrong held out).
 */
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import {
  cutDistanceLine,
  findTextLines,
  numberFrom,
  readTargetDistance,
  type DistanceGlyphs,
  discoverTextColours,
  readTargetDistanceAnyColour,
} from "../src/shared/hudTargetDistance.js";
import { GameStateStore } from "../src/server/gameState.js";
import {
  HUD_DISTANCE_FRESH_MS,
  SCAN_ROUTE_VIEW_MS,
  hudReadDistance,
  markScanRouteViewed,
  resetScanRouteViewForTests,
  scanRouteShip,
  setHudDistance,
} from "../src/server/shipInSystem.js";
import { steadyDistance } from "../src/client/aim/useDistanceReader.js";
import { legSpot, nextLeg, type ShipSpot } from "../src/client/scanRoute/scanRouteScene.js";

const W = 900;
const H = 900;
const S = 2; // pixels per font dot: a figure 14 px tall on a 900-row screen
const TALL: Record<string, string[]> = {
  "0": ["#####", "#...#", "#..##", "#.#.#", "##..#", "#...#", "#####"],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": ["#####", "....#", "....#", "#####", "#....", "#....", "#####"],
  "3": ["#####", "....#", "....#", ".####", "....#", "....#", "#####"],
  "5": ["#####", "#....", "#....", "#####", "....#", "....#", "#####"],
  "7": ["#####", "....#", "....#", "....#", "....#", "....#", "....#"],
  "8": ["#####", "#...#", "#...#", "#####", "#...#", "#...#", "#####"],
  "9": ["#####", "#...#", "#...#", "#####", "....#", "....#", "#####"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#####", "#.#.#", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
};
// Small letters: five rows, on the baseline. Every glyph one piece (the reader's pieces are 4-connected).
const SMALL: Record<string, string[]> = {
  s: ["#####", "#....", "#####", "....#", "#####"],
  m: ["#####", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
};

function frame(): Uint8ClampedArray {
  const f = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) f.set([10, 10, 22, 255], i * 4);
  return f;
}
/** The colour the font is drawn in: the game's own, unless a test draws an EDHM-like HUD. */
let INK: [number, number, number] = [240, 200, 0];
const dot = (f: Uint8ClampedArray, x: number, y: number) => {
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) f.set([...INK, 255], ((y + sy) * W + x + sx) * 4);
};

/** Draw `text` with its left edge at `x` and its baseline at `base`; monospaced, a comma or point a cell of its own. */
function draw(f: Uint8ClampedArray, text: string, x: number, base: number): void {
  const top = base - 7 * S + 1;
  let cx = x;
  for (const ch of text) {
    if (ch === "," || ch === ".") {
      dot(f, cx + 2 * S, base - S + 1);
      if (ch === ",") dot(f, cx + S, base + 1);
    } else if (ch === ":") {
      dot(f, cx + 2 * S, top + 2 * S);
      dot(f, cx + 2 * S, top + 5 * S);
    } else if (TALL[ch]) TALL[ch]!.forEach((row, ry) => [...row].forEach((c, rx) => c === "#" && dot(f, cx + rx * S, top + ry * S)));
    else if (SMALL[ch]) SMALL[ch]!.forEach((row, ry) => [...row].forEach((c, rx) => c === "#" && dot(f, cx + rx * S, top + (ry + 2) * S)));
    cx += 6 * S;
  }
}

/** A target's label: the distance, and the time to get there under it. */
function label(f: Uint8ClampedArray, dist: string, x: number, base: number, time: string | null = "0:27"): void {
  draw(f, dist, x, base);
  if (time) draw(f, time, x, base + 7 * S + 6);
}

/** The font's glyph table, cut the way the real one was. */
const GLYPHS: DistanceGlyphs = (() => {
  const tall: Record<string, number[][]> = {};
  const small: Record<string, number[][]> = {};
  const cut = (text: string) => {
    const f = frame();
    label(f, text, 100, 200);
    const lines = findTextLines(f, W, H);
    return cutDistanceLine(f, W, lines.find((l) => l.base === 200)!)!;
  };
  for (const d of "01235789") (tall[d] ??= []).push(cut(`${d}${d}${d}Ls`).figures[0]!);
  const ls = cut("111Ls");
  const mm = cut("111Mm");
  tall.L = [ls.cap];
  tall.M = [mm.cap];
  small.s = [ls.small];
  small.m = [mm.small];
  return { tall, small };
})();

describe("the game's number rules", () => {
  it("reads a point in three figures and thousands commas above, nothing else", () => {
    expect(numberFrom("859", [1])).toBe(8.59);
    expect(numberFrom("892", [2])).toBe(89.2);
    expect(numberFrom("093", [1])).toBe(0.93);
    expect(numberFrom("927", [])).toBe(927);
    expect(numberFrom("1957", [1])).toBe(1957);
    expect(numberFrom("12345", [2])).toBe(12345);
    expect(numberFrom("1234567", [1, 4])).toBe(1234567);
    // A comma missed, one in the wrong place, a leading zero, a point in four figures: not the game's.
    expect(numberFrom("1957", [])).toBeNull();
    expect(numberFrom("1957", [2])).toBeNull();
    expect(numberFrom("093", [])).toBeNull();
    expect(numberFrom("093", [2])).toBeNull();
    expect(numberFrom("12345", [1])).toBeNull();
  });
});

describe("the target's distance off the HUD", () => {
  it("reads the line with the time under it, in light-seconds", () => {
    const f = frame();
    label(f, "1,957Ls", 300, 400);
    expect(readTargetDistance(f, W, H, GLYPHS)).toMatchObject({ distLs: 1957, text: "1,957Ls", unit: "Ls" });
    const g = frame();
    label(g, "8.59Ls", 300, 400);
    expect(readTargetDistance(g, W, H, GLYPHS)).toMatchObject({ distLs: 8.59, text: "8.59Ls" });
    const z = frame();
    label(z, "0.93Ls", 300, 400);
    expect(readTargetDistance(z, W, H, GLYPHS)?.distLs).toBe(0.93);
  });

  it("turns megametres into light-seconds", () => {
    const f = frame();
    label(f, "13.1Mm", 300, 400);
    const r = readTargetDistance(f, W, H, GLYPHS)!;
    expect(r.text).toBe("13.1Mm");
    expect(r.distLs).toBeCloseTo(13.1 / 299.792458, 6);
  });

  it("skips another body's label (no time under it), and two targets' lines", () => {
    const f = frame();
    label(f, "1,853Ls", 100, 300, null);
    label(f, "1,802Ls", 400, 500);
    expect(readTargetDistance(f, W, H, GLYPHS)?.distLs).toBe(1802);
    const g = frame();
    label(g, "1,853Ls", 100, 300);
    label(g, "1,802Ls", 400, 500);
    expect(readTargetDistance(g, W, H, GLYPHS)).toBeNull();
    // Only another body's label: nothing.
    const h = frame();
    label(h, "1,853Ls", 100, 300, null);
    expect(readTargetDistance(h, W, H, GLYPHS)).toBeNull();
  });

  it("reads a crop by the whole screen's size", () => {
    const f = frame();
    label(f, "357Ls", 300, 400);
    // The top-left 600 x 600 of the frame, measured against the 900-row screen.
    const crop = new Uint8ClampedArray(600 * 600 * 4);
    for (let y = 0; y < 600; y++) crop.set(f.subarray(y * W * 4, (y * W + 600) * 4), y * 600 * 4);
    expect(readTargetDistance(crop, 600, 600, GLYPHS, H)?.distLs).toBe(357);
  });
});

/*
  Any HUD colour (owner 2026-11-06, his EDHM themes: white, blue, red, lavender text): the reader finds the target line
  by its shape, learns its colour and reads in it.
*/
describe("the target's distance in any HUD colour", () => {
  const drawn = (ink: [number, number, number], text: string) => {
    INK = ink;
    try {
      const f = frame();
      label(f, text, 300, 400);
      return f;
    } finally {
      INK = [240, 200, 0];
    }
  };

  it("learns white, red and the default orange from the line itself and reads in it", () => {
    for (const ink of [[235, 235, 235], [230, 40, 40], [240, 200, 0]] as [number, number, number][]) {
      const f = drawn(ink, "1,957Ls");
      const r = readTargetDistanceAnyColour(f, W, H, GLYPHS);
      expect(r?.reading.text).toBe("1,957Ls");
      expect(Math.hypot(r!.colour[0] - ink[0], r!.colour[1] - ink[1], r!.colour[2] - ink[2])).toBeLessThan(20);
    }
  });

  it("keeps reading in a colour it learned, and finds nothing in a colour that is not there", () => {
    const f = drawn([90, 170, 255], "8.59Ls");
    expect(discoverTextColours(f, W, H)[0]).toEqual([90, 170, 255]);
    expect(readTargetDistanceAnyColour(f, W, H, GLYPHS, H, [90, 170, 255])?.reading.distLs).toBe(8.59);
    expect(readTargetDistanceAnyColour(f, W, H, GLYPHS, H, [230, 40, 40])).toBeNull();
  });

  it("finds a dim text in the hue EDHM's ini names, and searches colour-blind when the hint is stale", () => {
    // Too dim for the colour-blind finder (its softest look wants 130); the ini's colour is brighter, the hue the same.
    const dim = drawn([110, 40, 120], "1,957Ls");
    expect(readTargetDistanceAnyColour(dim, W, H, GLYPHS)).toBeNull();
    const r = readTargetDistanceAnyColour(dim, W, H, GLYPHS, H, null, undefined, [220, 80, 240]);
    expect(r?.reading.text).toBe("1,957Ls");
    expect(r?.colour).toEqual([110, 40, 120]);
    // A green hint over white text (a theme changed, the ini not yet re-read): read all the same.
    const white = drawn([235, 235, 235], "8.59Ls");
    expect(readTargetDistanceAnyColour(white, W, H, GLYPHS, H, null, undefined, [0, 255, 0])?.reading.distLs).toBe(8.59);
  });

  it("splits two characters a bold font joins (his white 0.87Ls: the 7 and the L one piece)", () => {
    const f = drawn([235, 235, 235], "957Ls");
    // A bridge between the 7 and the L at the baseline, as EDHM's heavier font draws them.
    INK = [235, 235, 235];
    for (let x = 300 + 2 * 6 * S + 4 * S; x < 300 + 3 * 6 * S; x++) dot(f, x, 400 - S + 1);
    INK = [240, 200, 0];
    expect(readTargetDistanceAnyColour(f, W, H, GLYPHS)?.reading.text).toBe("957Ls");
  });
});

describe("the page's steadiness check", () => {
  it("posts the first reading and changes within half to twice the last, holds a jump one frame", () => {
    const r = (distLs: number) => ({ distLs, text: "", unit: "Ls" as const, x: 0, y: 0 });
    expect(steadyDistance(null, r(500), 1000)).toBe(true);
    expect(steadyDistance({ distLs: 500, atMs: 0 }, r(420), 1000)).toBe(true);
    expect(steadyDistance({ distLs: 500, atMs: 0 }, r(50), 1000)).toBe(false);
    // After a pause the new reading is taken as read.
    expect(steadyDistance({ distLs: 500, atMs: 0 }, r(50), 6000)).toBe(true);
  });
});

describe("the ship on the Scan route from the HUD's distance", () => {
  const T = "2026-11-05T19:00:00Z";
  const inSupercruise = () => {
    const s = new GameStateStore();
    s.apply({ timestamp: T, event: "FSDJump", StarSystem: "Here", SystemAddress: 77, StarPos: [0, 0, 0], BodyID: 0, Body: "Here A" } as never);
    s.statusDestination = { systemAddress: 77, bodyId: 3, name: "Here 3" };
    return s;
  };

  it("is a fix from the target while fresh, in supercruise, for the target still targeted", () => {
    const s = inSupercruise();
    expect(setHudDistance(s, 1957, 1000)).toBe(true);
    expect(scanRouteShip(s, null, 2000).fix).toEqual({ refId: 3, distLs: 1957, mode: "supercruise", atMs: 1000, from: "hud" });
    // Too old.
    expect(scanRouteShip(s, null, 1000 + HUD_DISTANCE_FRESH_MS + 1).fix).toBeNull();
    // Another body targeted since.
    s.statusDestination = { systemAddress: 77, bodyId: 4, name: "Here 4" };
    expect(scanRouteShip(s, null, 2000).fix).toBeNull();
  });

  it("is not kept without a target, nor used out of supercruise", () => {
    const s = inSupercruise();
    s.statusDestination = null;
    expect(setHudDistance(s, 12, 1000)).toBe(false);
    s.statusDestination = { systemAddress: 77, bodyId: 3, name: "Here 3" };
    setHudDistance(s, 12, 1000);
    s.apply({ timestamp: T, event: "SupercruiseExit", StarSystem: "Here", SystemAddress: 77, Body: "Here 3", BodyID: 3, BodyType: "Planet" } as never);
    expect(scanRouteShip(s, null, 1500).fix).toBeNull();
  });
});

describe("the ship's leg between where it was and the target", () => {
  // Arrival star 0 at the origin, planet 9 (the target) 2,000 ls out, planet 5 elsewhere; the compact view's places
  // mirror the true ones at a tenth.
  const P: Record<number, { x: number; y: number; z: number }> = { 0: { x: 0, y: 0, z: 0 }, 9: { x: 2000, y: 0, z: 0 }, 5: { x: 0, y: 1000, z: 0 } };
  const spot = (id: number): ShipSpot | null => (P[id] ? { pos: P[id]!, view: { x: P[id]!.x / 10, y: P[id]!.y / 10, z: 0 } } : null);
  const fly = (leg: ReturnType<typeof nextLeg>, distLs: number | null, more: Partial<Parameters<typeof nextLeg>[1]> = {}) =>
    nextLeg(leg, { addr: "77", atId: 0, atFrom: "journal", targetId: 9, distLs, ...more }, spot, more.atId ?? 0);

  it("moves on with the distance, never back, and holds without one", () => {
    let leg = fly(null, 1800);
    expect(leg!.t).toBeCloseTo(0.1, 9);
    leg = fly(leg, 500);
    expect(leg!.t).toBe(0.75);
    expect(fly(leg, null)).toBe(leg);
    // Past the target the distance grows again: held at the target.
    leg = fly(leg, 0);
    expect(fly(leg, 300)!.t).toBe(1);
  });

  it("is not moved by the netlog passing near another body (owner 2026-11-05: a barycentre 8.3 ls off)", () => {
    const leg = fly(fly(null, 1000), null, { atId: 8, atFrom: "netlog" });
    expect(leg!.t).toBe(0.5);
    // A journal event at another body ends it: a new leg from that body. Reaching the target ends it.
    expect(fly(leg, null, { atId: 5, atFrom: "journal" })).toMatchObject({ fromId: 5, t: 0 });
    expect(nextLeg(leg, { addr: "77", atId: 9, atFrom: "netlog", targetId: 9, distLs: null }, spot, 9)).toBeNull();
  });

  it("another target starts from where the ship is, not from a body", () => {
    const leg = fly(null, 1000);
    const at = legSpot(leg!, spot(9)!);
    const next = nextLeg(leg, { addr: "77", atId: 0, atFrom: "journal", targetId: 5, distLs: null }, spot, 0)!;
    expect(next).toMatchObject({ targetId: 5, t: 0, fromId: null });
    expect(next.from.pos).toEqual(at.pos);
    expect(next.from.view).toEqual(at.view);
    // Its distance is measured from there: halfway from (1000, 0) to (0, 1000).
    const len = Math.hypot(1000, 1000);
    expect(nextLeg(next, { addr: "77", atId: 0, atFrom: "journal", targetId: 5, distLs: len / 2 }, spot, 0)!.t).toBeCloseTo(0.5, 9);
  });

  it("starts again in another system, and has nothing to do with no target", () => {
    const leg = fly(null, 1000);
    expect(nextLeg(leg, { addr: "78", atId: 0, atFrom: "journal", targetId: 9, distLs: null }, spot, 0)).toMatchObject({ addr: "78", t: 0 });
    expect(fly(null, null, { targetId: null })).toBeNull();
    // The target untargeted for a moment: the leg stays (the ship where it was).
    expect(fly(leg, null, { targetId: null })).toBe(leg);
  });
});

describe("the distance reader's trigger", () => {
  it("holds while the Scan route shows, in supercruise, with a body of this system targeted; pushes when it changes", () => {
    vi.useFakeTimers();
    try {
      resetScanRouteViewForTests();
      const s = new GameStateStore();
      s.apply({ timestamp: "2026-11-05T19:00:00Z", event: "FSDJump", StarSystem: "Here", SystemAddress: 77, StarPos: [0, 0, 0], BodyID: 0, Body: "Here A" } as never);
      const now = Date.now();
      expect(hudReadDistance(s, now)).toBe(false);
      const push = vi.fn();
      markScanRouteViewed(push, now);
      expect(push).toHaveBeenCalledOnce();
      // No target yet.
      expect(hudReadDistance(s, now)).toBe(false);
      s.statusDestination = { systemAddress: 77, bodyId: 3, name: "Here 3" };
      expect(hudReadDistance(s, now)).toBe(true);
      // Asked again while showing: no push; stops showing: one push when it lapses.
      markScanRouteViewed(push, now + 250);
      expect(push).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(SCAN_ROUTE_VIEW_MS + 200);
      expect(push).toHaveBeenCalledTimes(2);
      expect(hudReadDistance(s, now + 250 + SCAN_ROUTE_VIEW_MS + 1)).toBe(false);
      // Out of supercruise.
      markScanRouteViewed(push, now + 10_000);
      s.apply({ timestamp: "2026-11-05T19:00:00Z", event: "SupercruiseExit", StarSystem: "Here", SystemAddress: 77, Body: "Here 3", BodyID: 3, BodyType: "Planet" } as never);
      expect(hudReadDistance(s, now + 10_000)).toBe(false);
    } finally {
      resetScanRouteViewForTests();
      vi.useRealTimers();
    }
  });
});

describe("the marker window opened for the distance reader", () => {
  const require = createRequire(import.meta.url);
  const { createAimWindow } = require("../electron/aimWindow.cjs") as { createAimWindow: (deps: unknown) => Aim };
  type Aim = { set: (on: boolean) => boolean; setReader: (on: boolean) => boolean; sync: () => void };
  const opened: string[] = [];
  let live = 0;
  class FakeWindow {
    destroyed = false;
    visible = false;
    webContents = { mainFrame: {} };
    constructor() {
      live++;
    }
    setIgnoreMouseEvents() {}
    setAlwaysOnTop() {}
    on() {}
    loadURL(u: string) {
      opened.push(u);
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      live--;
    }
    getBounds() {
      return { x: 0, y: 0, width: 10, height: 10 };
    }
    setBounds() {}
    isVisible() {
      return this.visible;
    }
    showInactive() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
  }

  it("opens without the marks for the reader, with them once the marker is on, and closes when both are off", () => {
    const aim = createAimWindow({
      BrowserWindow: FakeWindow,
      getBaseUrl: () => "http://127.0.0.1:7111",
      preloadPath: "preload.cjs",
      getDisplay: () => ({ bounds: { x: 0, y: 0, width: 10, height: 10 } }),
      isAllowed: () => true,
    });
    aim.setReader(true);
    expect(opened.at(-1)).toBe("http://127.0.0.1:7111/aim-overlay.html?marks=0");
    expect(live).toBe(1);
    aim.set(true);
    expect(opened.at(-1)).toBe("http://127.0.0.1:7111/aim-overlay.html");
    expect(live).toBe(1);
    aim.setReader(false);
    expect(live).toBe(1);
    aim.set(false);
    expect(live).toBe(0);
  });
});
