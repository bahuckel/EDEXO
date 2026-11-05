/**
 * The Scan route's distance reader (plan 1.3.8): the target's distance read off the HUD (shared/hudTargetDistance.ts),
 * the game's number rules for its comma and point, the server's fix from it (server/shipInSystem.ts), the page's
 * steadiness check, and the marker window opening for the reader alone (electron/aimWindow.cjs). The frames are drawn
 * with a plain 5 x 7 font and a glyph table made from it, so the logic is tested without a picture of the game; the
 * real table (hudDistanceGlyphs.ts) was measured on the owner's 170 F10 shots (scripts/build-hud-distance-glyphs.ts
 * --check: 167 right, 3 not sure, 0 wrong held out).
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { cutDistanceLine, findTextLines, numberFrom, readTargetDistance, type DistanceGlyphs } from "../src/shared/hudTargetDistance.js";
import { GameStateStore } from "../src/server/gameState.js";
import { HUD_DISTANCE_FRESH_MS, scanRouteShip, setHudDistance } from "../src/server/shipInSystem.js";
import { steadyDistance } from "../src/client/aim/useDistanceReader.js";
import { shipProgress } from "../src/client/scanRoute/scanRouteScene.js";

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
const dot = (f: Uint8ClampedArray, x: number, y: number) => {
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) f.set([240, 200, 0, 255], ((y + sy) * W + x + sx) * 4);
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

describe("the ship's arrow between the last body and the target", () => {
  it("moves on with the distance, never back, holds without a fix, starts again for another pair", () => {
    let p = shipProgress(null, "77:0>3", 1800, 2000);
    expect(p!.key).toBe("77:0>3");
    expect(p!.t).toBeCloseTo(0.1, 9);
    p = shipProgress(p, "77:0>3", 500, 2000);
    expect(p!.t).toBe(0.75);
    // A frame not read, the target off the screen: where it was.
    expect(shipProgress(p, "77:0>3", null, 2000)).toBe(p);
    // Past the target the distance grows again: held at the target, not sent back.
    p = shipProgress(p, "77:0>3", 0, 2000);
    expect(shipProgress(p, "77:0>3", 300, 2000)!.t).toBe(1);
    // Further than the way is long (flying off the other way first): at the last body.
    expect(shipProgress(null, "77:0>3", 2500, 2000)!.t).toBe(0);
    // Another target: from the start of its own way.
    expect(shipProgress(p, "77:0>4", 900, 1000)!.t).toBeCloseTo(0.1, 9);
    expect(shipProgress(p, "77:0>4", null, 1000)).toBeNull();
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
