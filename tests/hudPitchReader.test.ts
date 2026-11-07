/**
 * The pitch read off the game's HUD (owner, 2026-11-04): the two boxes beside the centre found as a mirrored pair, the
 * left one read first, the minus told apart, a crop of the middle read like the whole frame (shared/hudPitchReader.ts),
 * and the HUD's number taking over from the flight-path estimate while fresh (server/liveFix.ts). The frames are drawn
 * with a plain 5 x 7 font and a glyph table made from it, so the logic is tested without any picture of the game; the
 * real table (hudPitchGlyphs.ts) is measured against real captures.
 */
import { describe, expect, it } from "vitest";
import {
  discoverPitchColours,
  findPitchBoxes,
  glyphVector,
  readHudHeading,
  readHudPitch,
  readHudPitchAnyColour,
  type HudGlyphs,
} from "../src/shared/hudPitchReader.js";
import { lookFromColour, type Rgb } from "../src/shared/hudTextLook.js";
import { GameStateStore } from "../src/server/gameState.js";
import { applyLiveFix, setHudPitch } from "../src/server/liveFix.js";
import { projectMarks, viewOf } from "../src/client/aim/project.js";

const W = 2000;
const H = 900;
const S = 3; // pixels per font dot
const FONT: Record<string, string[]> = {
  "0": ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": ["#####", "....#", "....#", "#####", "#....", "#....", "#####"],
  "8": ["#####", "#...#", "#...#", "#####", "#...#", "#...#", "#####"],
  "9": ["#####", "#...#", "#...#", "#####", "....#", "....#", "#####"],
};

function frame(): Uint8ClampedArray {
  const f = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) f.set([110, 100, 92, 255], i * 4);
  return f;
}
const YELLOW_RGB: Rgb = [240, 220, 10];
const dot = (f: Uint8ClampedArray, x: number, y: number, c: Rgb) => {
  for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) f.set([...c, 255], ((y + sy) * W + x + sx) * 4);
};

/** Draw a string ("-10") with its left edge at `x`, centred on `y`. */
function draw(f: Uint8ClampedArray, text: string, x: number, y: number, c: Rgb = YELLOW_RGB): void {
  const top = Math.round(y - (7 * S) / 2);
  let cx = x;
  for (const ch of text) {
    if (ch === "-") {
      for (let k = 0; k < 4; k++) dot(f, cx + k * S, top + 3 * S, c);
      cx += 6 * S;
      continue;
    }
    FONT[ch]!.forEach((row, ry) => [...row].forEach((d, rx) => d === "#" && dot(f, cx + rx * S, top + ry * S, c)));
    cx += 7 * S;
  }
}

/** The font's glyph table, cut the way the real one was: each digit read from a drawn pair (the yellow look). */
const YELLOW: Record<string, number[][]> = Object.fromEntries(
  Object.keys(FONT).map((d) => {
    const f = frame();
    draw(f, d, 860, 450);
    draw(f, d, 1120, 450);
    return [d, [glyphVector(f, W, findPitchBoxes(f, W, H)!.left.digits[0]!)]];
  }),
);
const GLYPHS: HudGlyphs = { yellow: YELLOW };

describe("HUD pitch reader", () => {
  it("reads the left box of the mirrored pair, with its minus", () => {
    const f = frame();
    draw(f, "-20", 840, 450);
    draw(f, "-20", 1120, 450);
    // No ladder drawn: the middle of the degree the box shows (the game drops the fraction).
    expect(readHudPitch(f, W, H, GLYPHS)).toMatchObject({ boxDeg: -20, pitchDeg: -20.5, boxes: 2, pxPerDeg: null });
  });

  it("tells the minus on bright ground that inks a little everywhere (2026-11-06: -19 over sand read as 19)", () => {
    const f = frame();
    for (let i = 0; i < W * H; i++) f.set([200, 180, 52, 255], i * 4); // ink 0.4, the sand behind his gear-down box
    draw(f, "-19", 840, 450);
    draw(f, "-19", 1120, 450);
    expect(readHudPitch(f, W, H, GLYPHS)?.boxDeg).toBe(-19);
    const g = frame();
    for (let i = 0; i < W * H; i++) g.set([200, 180, 52, 255], i * 4);
    draw(g, "19", 858, 450);
    draw(g, "19", 1120, 450);
    expect(readHudPitch(g, W, H, GLYPHS)?.boxDeg).toBe(19);
  });

  it("reads a nose-up pitch without a minus, and the roll from the boxes' tilt", () => {
    const f = frame();
    draw(f, "89", 850, 430);
    draw(f, "89", 1114, 470);
    const r = readHudPitch(f, W, H, GLYPHS)!;
    expect(r.boxDeg).toBe(89);
    expect(r.pitchDeg).toBe(89.5);
    expect(r.rollDeg).toBeGreaterThan(5);
  });

  it("finds nothing without a mirrored pair, and reads a crop of the middle like the whole frame", () => {
    const f = frame();
    draw(f, "-10", 840, 450);
    expect(readHudPitch(f, W, H, GLYPHS)).toBeNull();
    draw(f, "-10", 1120, 450);
    const cw = W * 0.4;
    const ch = H * 0.4;
    const ox = (W - cw) / 2;
    const oy = (H - ch) / 2;
    const crop = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) crop.set(f.subarray(((y + oy) * W + ox) * 4, ((y + oy) * W + ox + cw) * 4), y * cw * 4);
    expect(readHudPitch(crop, cw, ch, GLYPHS, { w: W, h: H })).toMatchObject({ boxDeg: -10 });
  });

  it("takes the fraction from the ladder's 5-degree rungs, and the screen's pixels per degree", () => {
    // Nose at -10.4: the box shows -10; rungs every 5 degrees right of the left box, at the screen's own spacing
    // (25.3 px a degree at 1440 rows: 15.8 at 900).
    const f = frame();
    draw(f, "-10", 840, 450);
    draw(f, "-10", 1120, 450);
    const orange = (x: number, y: number) => f.set([230, 140, 40, 255], (y * W + x) * 4);
    const ppd = 15.8;
    const boxY = 450 - 0.5; // the drawn string's middle row
    for (const v of [-5, -10, -15]) {
      const y = Math.round(boxY - (v - -10.4) * ppd);
      for (let x = 912; x < 945; x++) for (let k = 0; k < 3; k++) orange(x, y - 1 + k);
    }
    const r = readHudPitch(f, W, H, GLYPHS)!;
    expect(r.boxDeg).toBe(-10);
    expect(r.pitchDeg).toBeCloseTo(-10.4, 1);
    expect(r.pxPerDeg).toBeCloseTo(15.8, 0);
  });

  it("reads the heading off the tape: the box, and the fraction from the 10-degree ticks under it", () => {
    // Heading 29.4: the box shows 29 (centred on the screen's centre line), long ticks every 10, 12 px a degree.
    const f = frame();
    draw(f, "29", 982, 243);
    const orange = (x: number, y: number) => f.set([230, 140, 40, 255], (y * W + x) * 4);
    for (let deg = 14; deg <= 44; deg += 2) {
      const x = Math.round(1000 + (deg - 29.4) * 12);
      const long = deg % 10 === 0;
      for (let y = 262; y < 262 + (long ? 24 : 10); y++) for (let k = 0; k < 3; k++) orange(x - 1 + k, y);
    }
    const r = readHudHeading(f, W, H, GLYPHS, { ox: 0, oy: 0, screen: { w: W, h: H } })!;
    expect(r.boxDeg).toBe(29);
    expect(r.headingDeg).toBeCloseTo(29.4, 0);
    expect(r.pxPerDeg).toBeCloseTo(12, 0);
  });

  /*
    A recoloured HUD (owner's EDHM shots, 2026-11-07): grey digits in a green outline, the ladder's labels the same grey
    but free-standing. Dark ground, as on his planet.
  */
  const GREY: Rgb = [150, 150, 150];
  const GREEN: Rgb = [0, 160, 0];
  const dark = () => {
    const f = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) f.set([25, 15, 15, 255], i * 4);
    return f;
  };
  /** A box: the string in grey, a 2-pixel green outline 8 rows above and below its digits, wider than the string. */
  function boxed(f: Uint8ClampedArray, text: string, x: number, y: number): void {
    draw(f, text, x, y, GREY);
    const top = Math.round(y - (7 * S) / 2);
    const right = x + text.length * 7 * S;
    for (const ly of [top - 8, top - 7, top + 7 * S + 6, top + 7 * S + 7])
      for (let lx = x - 30; lx < right + 10; lx++) f.set([...GREEN, 255], (ly * W + lx) * 4);
  }
  /** The font's glyphs cut in the grey's own ink, as the any-colour table is cut. */
  const ANY: Record<string, number[][]> = Object.fromEntries(
    Object.keys(FONT).map((d) => {
      const f = dark();
      boxed(f, d, 860, 450);
      boxed(f, d, 1120, 450);
      const pair = findPitchBoxes(f, W, H, { w: W, h: H }, lookFromColour(GREY), true)!;
      return [d, [glyphVector(f, W, pair.left.digits[0]!, undefined, undefined, lookFromColour(GREY).ink)]];
    }),
  );

  it("reads a recoloured HUD's boxes by their outline, learning the digits' and outline's colours", () => {
    const f = dark();
    boxed(f, "-10", 840, 480);
    boxed(f, "-10", 1120, 480);
    // The ladder's labels: the same grey, mirrored, nearer the centre line, no outline.
    draw(f, "-9", 870, 440, GREY);
    draw(f, "-9", 1100, 440, GREY);
    expect(readHudPitch(f, W, H, GLYPHS)).toBeNull();
    const [c] = discoverPitchColours(f, W, H);
    expect(c!.text[0]).toBeGreaterThan(130);
    expect(c!.frame[1]).toBeGreaterThan(c!.frame[0] + 100);
    const r = readHudPitchAnyColour(f, W, H, GLYPHS, ANY)!;
    expect(r.reading).toMatchObject({ boxDeg: -10, style: "learned" });
    // The colours learned read the next frame without looking for them again.
    expect(readHudPitchAnyColour(f, W, H, GLYPHS, ANY, { w: W, h: H }, r.colours, false)?.reading.boxDeg).toBe(-10);
  });

  it("reads no recoloured pair without outlines, and the game's own look as before", () => {
    const f = dark();
    draw(f, "-10", 840, 450, GREY);
    draw(f, "-10", 1120, 450, GREY);
    expect(readHudPitchAnyColour(f, W, H, GLYPHS, ANY)).toBeNull();
    const g = frame();
    draw(g, "-10", 840, 450);
    draw(g, "-10", 1120, 450);
    expect(readHudPitchAnyColour(g, W, H, GLYPHS, ANY)).toMatchObject({ reading: { boxDeg: -10, style: "yellow" }, colours: null });
  });

  it("finds the boxes in the hue EDHM's ini names, brightness free, and searches blind when the hint is wrong", () => {
    const f = dark();
    boxed(f, "-10", 840, 480);
    boxed(f, "-10", 1120, 480);
    // The ini says a brighter white than the screen shows (his 243 grey drawn at 150): the hue is what counts.
    const hint = { text: [243, 243, 243] as Rgb, frame: [0, 213, 0] as Rgb };
    expect(discoverPitchColours(f, W, H, { w: W, h: H }, hint)).toHaveLength(1);
    expect(readHudPitchAnyColour(f, W, H, GLYPHS, ANY, { w: W, h: H }, null, true, hint)?.reading.boxDeg).toBe(-10);
    // A stale hint (another theme's purple) finds nothing; the blind search still reads.
    const stale = { text: [120, 30, 200] as Rgb, frame: [255, 165, 0] as Rgb };
    expect(readHudPitchAnyColour(f, W, H, GLYPHS, ANY, { w: W, h: H }, null, true, stale)?.reading.boxDeg).toBe(-10);
  });

  it("says not sure for a digit it has no glyph for", () => {
    const f = frame();
    draw(f, "-10", 840, 450);
    draw(f, "-10", 1120, 450);
    const { "1": _one, ...noOne } = YELLOW;
    expect(readHudPitch(f, W, H, { yellow: noOne })).toBeNull();
  });
});

describe("HUD pitch in the live fix", () => {
  const fix = { latDeg: 10, lonDeg: 20, planetRadiusM: 1_000_000, bodyName: "A 1", headingDeg: 0, altitudeM: 40, temperatureK: null, gravityG: null };

  it("takes the HUD's number while fresh, then the estimate again; never on foot", () => {
    const store = new GameStateStore();
    setHudPitch(store, { pitchDeg: -20, rollDeg: 3 }, 1000);
    applyLiveFix(store, { ...fix }, 2000);
    expect(store.exoOrganicLastFix).toMatchObject({ pitchDeg: -20, rollDeg: 3, pitchFromHud: true });
    applyLiveFix(store, { ...fix, latDeg: 10.0001 }, 9000);
    expect(store.exoOrganicLastFix!.pitchFromHud).toBe(false);
    setHudPitch(store, { pitchDeg: -20, rollDeg: 0 }, 9000);
    applyLiveFix(store, { ...fix, altitudeM: null }, 9100);
    expect(store.exoOrganicLastFix!.pitchFromHud).toBe(false);
  });
});

describe("screen marker roll", () => {
  it("turns a mark's place with the HUD's roll", () => {
    const view = viewOf(2000, 1000, 50);
    const mark = { kind: "codex" as const, eastM: 100, northM: 400, distanceM: Math.hypot(100, 400), label: "x" };
    const base = { radiusM: 500, headingDeg: 0, minSampleDistanceM: 0, marks: [mark], altitudeM: 50, pitchDeg: 0 };
    const [flat] = projectMarks(base, view);
    const [rolled] = projectMarks({ ...base, rollDeg: 30 }, view);
    // Same distance from the centre, turned 30 degrees.
    const d = (s: { x: number; y: number }) => Math.hypot(s.x - 1000, s.y - 500);
    expect(d(rolled!)).toBeCloseTo(d(flat!), 3);
    const ang = (s: { x: number; y: number }) => (Math.atan2(s.y - 500, s.x - 1000) * 180) / Math.PI;
    expect(ang(rolled!) - ang(flat!)).toBeCloseTo(30, 1);
  });
});
