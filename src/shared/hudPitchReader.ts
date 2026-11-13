/**
 * The ship's pitch, read off the game's own HUD (owner, 2026-11-04: "it should take the angle … off the screen").
 * Status.json has no pitch; the cockpit HUD shows it in two boxes either side of the centre, at the pitch ladder's
 * current rung ("-10", "89"). This finds those boxes in a frame of the game and reads them:
 *
 * - the digits are the HUD's brightest yellow (about 240, 220, 10); the game draws them blurred, holes filled, so a
 *   digit is matched as a whole against glyphs cut from the owner's own screenshots (hudPitchGlyphs.ts): normalised
 *   correlation of a small grey image;
 * - the two boxes are a mirrored pair about the screen's centre, which is what picks them out of the other yellow text
 *   (the latitude readout, the ladder's labels); the line through them gives the roll;
 * - the minus is a short bar left of the digits, told by the yellow at their middle height and none above or below.
 *
 * Pure (a frame in, a reading out), so it is tested on the owner's screenshots; the capture is the screen marker's
 * (aim/). Null when it cannot be sure: no boxes (SRV, on foot, a menu), a glyph not close enough, the two disagreeing.
 *
 * A recoloured HUD (EDHM; owner 2026-11-07, his green theme: grey or white digits in a green box, the ladder's labels in
 * the same grey) is read by readHudPitchAnyColour: the boxes found by their shape and their outline, the colours
 * learned from them.
 */
import { findingLook, hueLook, lookFromColour, MAX_TEXT_SHARE, sameColour, strokeColour, type Rgb, type TextLook } from "./hudTextLook.js";

export interface PitchReading {
  /** Degrees, the fraction from the ladder when its rungs were found (else the box's whole degrees). */
  pitchDeg: number;
  /** Degrees, positive with the right box lower (rolled right). */
  rollDeg: number;
  /** How many of the two boxes were read (always both, agreeing). */
  boxes: 2;
  /** The box's whole number as shown (the game drops the fraction: -9.7 shows as -9). */
  boxDeg: number;
  /** Screen pixels per degree of pitch at the centre, from the ladder's rungs; null when fewer than two were found. */
  pxPerDeg: number | null;
  /** The HUD's look it was read in (gear up yellow, gear down orange; "learned": a recoloured HUD's own colours). */
  style: HudStyleName | "learned";
  /** The HUD's centre (the two boxes' midpoint), in the frame's pixels: where the nose points on the screen. */
  centre: { x: number; y: number };
}

// The ladder's rungs: orange; dimmer and thinner in the landing (gear down) look, so the test is a little loose.
const isLadderPx = (r: number, g: number, b: number) => r > 160 && g > 60 && g < 210 && b < 100 && r - b > 100;

/**
 * The pitch to a fraction of a degree, from the ladder (owner, 2026-11-04: the dot jumped above and below the plant
 * with the box's whole degrees; the box shows -9 for -9.7). The ladder's 5-degree rungs (long orange dashes just right
 * of the left box) slide with the nose; the box sits at the nose's pitch on that ladder. A rung `V` degrees at height
 * `y` puts the nose at V - (boxY - y) / pxPerDeg, pxPerDeg from the rungs' spacing (5 degrees apart). Each rung's V is
 * the multiple of 5 that lands within 1.5 deg of the box's number. Null when fewer than two rungs agree.
 */
function refineFromLadder(
  rgba: Rgba,
  w: number,
  h: number,
  box: PitchBox,
  boxDeg: number,
  rollDeg: number,
  expectPxPerDeg: number,
  isLadder: (r: number, g: number, b: number) => boolean = isLadderPx,
): { pitchDeg: number; pxPerDeg: number } | null {
  const right = Math.max(...box.digits.map((c) => c.x1));
  const x0 = Math.round(right + box.dh * 0.6);
  const x1 = Math.min(w, Math.round(right + box.dh * 4));
  const y0 = Math.max(0, Math.round(box.y - box.dh * 12));
  const y1 = Math.min(h, Math.round(box.y + box.dh * 12));
  const minRun = box.dh * 0.9;
  // Rows holding a long orange dash: a rung (the labels' digits and the small ticks are shorter).
  const rows: { y: number; x: number }[] = [];
  for (let y = y0; y < y1; y++) {
    let run = 0;
    let best = 0;
    let bestEnd = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (isLadder(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)) {
        run++;
        if (run > best) {
          best = run;
          bestEnd = x;
        }
      } else run = 0;
    }
    if (best >= minRun) rows.push({ y, x: bestEnd - best / 2 });
  }
  // Consecutive rows are one rung; its middle row is the rung's height.
  const rungs: { y: number; x: number }[] = [];
  let group: { y: number; x: number }[] = [];
  const flush = () => {
    if (group.length) rungs.push({ y: group.reduce((t, g) => t + g.y, 0) / group.length, x: group.reduce((t, g) => t + g.x, 0) / group.length });
    group = [];
  };
  for (const r of rows) {
    if (group.length && r.y - group[group.length - 1]!.y > 1) flush();
    group.push(r);
  }
  flush();
  if (!rungs.length) return null;
  // Spacing: each gap between found rungs is a whole number of 5-degree steps. The rung level with the box hides
  // behind it, so near a multiple of 5 the nearest found rungs are 10 degrees apart (owner's F10 shots at -10 and -39
  // read as twice the spacing and fell back to the middle of the degree); the expected spacing counts the steps.
  const steps = rungs
    .slice(1)
    .map((r, i) => r.y - rungs[i]!.y)
    .map((g) => g / Math.max(1, Math.round(g / (5 * expectPxPerDeg))))
    .sort((a, b) => a - b);
  // One rung (the other lost against bright ground; his -10, -50 and 3): the screen's own spacing.
  const step = steps.length ? steps[Math.floor(steps.length / 2)]! : 5 * expectPxPerDeg;
  if (!(step > box.dh * 2)) return null;
  const pxPerDeg = step / 5;
  // Roll tilts the rungs: a rung's height is taken at the box's column.
  const tilt = Math.tan((rollDeg * Math.PI) / 180);
  const fits = rungs.map((r) => {
    const yAtBox = r.y - (r.x - box.x) * tilt;
    const off = (box.y - yAtBox) / pxPerDeg;
    // The rung's value: the multiple of 5 that puts the nose nearest the box's number.
    const v = Math.round((boxDeg + off) / 5) * 5;
    return v - off;
  });
  const near = fits.filter((f) => Math.abs(f - boxDeg) <= 1.5);
  if (near.length < Math.min(2, rungs.length)) return null;
  const mean = near.reduce((t, f) => t + f, 0) / near.length;
  if (near.some((f) => Math.abs(f - mean) > 0.4)) return null;
  return { pitchDeg: Math.round(mean * 10) / 10, pxPerDeg };
}

type Rgba = Uint8Array | Uint8ClampedArray;
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Glyph image size the digits are compared at (columns x rows). */
export const GLYPH_W = 10;
export const GLYPH_H = 15;
/** Correlation a digit must reach, and how far ahead of the next best. */
const MIN_MATCH = 0.75;
const MIN_MARGIN = 0.04;

/** How yellow a pixel is: the HUD's digits near 1, its orange box low, the ground 0. */
const yellowness = (r: number, g: number, b: number) => Math.max(0, Math.min(1, (Math.min(r, g) - b - 60) / 170));
// The digit cores only (about 250, 230, 5): at full size the box border is nearly as yellow (215-248, 178-207, 25-32).
const isDigitPx = (r: number, g: number, b: number) => r >= 225 && g >= 212 && b <= 20;

/**
 * A star's white: counted with the digits so a star on a digit does not cut it in two (his +49 read as -9: a star on the
 * 4's crossbar split the 4, and the piece left over looked like a minus). A lone star is far too small to pass as one.
 */
const isStarPx = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200;

/**
 * The HUD's two looks (owner, 2026-11-04): gear up, the pitch and heading boxes' digits are bold yellow; landing gear
 * down, the HUD turns to its landing look and they are a thinner orange (about 230, 180, 40), the ladder's labels in the
 * same orange beside them. Each look has its own digit colour, its own ink measure and its own glyphs.
 */
export type HudStyleName = "yellow" | "orange";
const STYLES: Record<HudStyleName, TextLook> = {
  yellow: { isText: isDigitPx, ink: yellowness },
  orange: {
    isText: (r, g, b) => r >= 200 && g >= 135 && g <= 205 && b <= 75 && r - b >= 150,
    ink: (r, g, b) => Math.max(0, Math.min(1, (r - b - 80) / 120)),
  },
};
/** A look's ink measure (the glyph builder cuts samples with it). */
export const styleInk = (s: HudStyleName): ((r: number, g: number, b: number) => number) => STYLES[s].ink;
/** Each look's glyphs: a digit to its samples (glyphVector each); a reading matches the nearest sample. */
export type HudGlyphs = Partial<Record<HudStyleName, PitchGlyphs>>;
/** One look's glyphs (or the any-colour table's, hudPitchGlyphsAny.ts). */
export type PitchGlyphs = Readonly<Record<string, readonly (readonly number[])[]>>;
const lookOf = (s: HudStyleName | TextLook): TextLook => (typeof s === "string" ? STYLES[s] : s);

/*
  Masks kept from frame to frame (review §4.3.4): a new frame-sized array per look and per pass was megabytes of garbage
  a frame, four frames a second. Each slot belongs to one caller, used within one call that never reaches another
  caller of the same slot. The caller clears the region it reads with fill (a memset): writing every cell 0 or 1 in
  the mask loop was 5 % slower than a fresh array.
*/
type ScratchSlot = "look" | "heading" | "text" | "seen" | "inner" | "roll" | "turned";
const scratch: Record<ScratchSlot, Uint8Array> = {
  look: new Uint8Array(0),
  heading: new Uint8Array(0),
  text: new Uint8Array(0),
  seen: new Uint8Array(0),
  inner: new Uint8Array(0),
  roll: new Uint8Array(0),
  turned: new Uint8Array(0),
};
/** A slot's mask, at least `n` cells; its old contents left in it. */
export function scratchMask(slot: ScratchSlot, n: number): Uint8Array {
  if (scratch[slot].length < n) scratch[slot] = new Uint8Array(n);
  return scratch[slot];
}

/** Connected pieces of a mask (4-neighbour), in a region. */
export function components(mask: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): Rect[] {
  const seen = scratchMask("seen", mask.length);
  for (let y = y0; y < y1; y++) seen.fill(0, y * w + x0, y * w + x1);
  const out: Rect[] = [];
  const stack: number[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (!mask[i] || seen[i]) continue;
      const c: Rect = { x0: x, y0: y, x1: x, y1: y };
      seen[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop()!;
        const jx = j % w;
        const jy = (j - jx) / w;
        if (jx < c.x0) c.x0 = jx;
        if (jx > c.x1) c.x1 = jx;
        if (jy < c.y0) c.y0 = jy;
        if (jy > c.y1) c.y1 = jy;
        // The four neighbours inline (an array literal for them was a 4-element allocation per pixel visited).
        if (jx > x0 && mask[j - 1] && !seen[j - 1]) {
          seen[j - 1] = 1;
          stack.push(j - 1);
        }
        if (jx + 1 < x1 && mask[j + 1] && !seen[j + 1]) {
          seen[j + 1] = 1;
          stack.push(j + 1);
        }
        if (jy > y0 && mask[j - w] && !seen[j - w]) {
          seen[j - w] = 1;
          stack.push(j - w);
        }
        if (jy + 1 < y1 && mask[j + w] && !seen[j + w]) {
          seen[j + w] = 1;
          stack.push(j + w);
        }
      }
      out.push(c);
    }
  return out;
}

/** A piece as a small grey image, zero mean and unit length, for correlation. */
export function glyphVector(rgba: Rgba, w: number, c: Rect, gw = GLYPH_W, gh = GLYPH_H, ink = yellowness): number[] {
  const cw = c.x1 - c.x0 + 1;
  const ch = c.y1 - c.y0 + 1;
  const v: number[] = [];
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const ax = Math.floor(c.x0 + (gx * cw) / gw);
      const bx = Math.max(ax + 1, Math.ceil(c.x0 + ((gx + 1) * cw) / gw));
      const ay = Math.floor(c.y0 + (gy * ch) / gh);
      const by = Math.max(ay + 1, Math.ceil(c.y0 + ((gy + 1) * ch) / gh));
      let sum = 0;
      let n = 0;
      for (let y = ay; y < by; y++)
        for (let x = ax; x < bx; x++) {
          const i = (y * w + x) * 4;
          sum += ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
          n++;
        }
      v.push(n ? sum / n : 0);
    }
  const mean = v.reduce((t, x) => t + x, 0) / v.length;
  const c0 = v.map((x) => x - mean);
  const norm = Math.sqrt(c0.reduce((t, x) => t + x * x, 0)) || 1;
  return c0.map((x) => x / norm);
}

/** The digit a piece looks most like, or null when nothing is close enough (or two are about as close). */
export function matchDigit(v: readonly number[], glyphs: Readonly<Record<string, readonly (readonly number[])[]>>): number | null {
  const g = matchGlyph(v, glyphs);
  return g == null ? null : Number(g);
}

/** The glyph (a table's key: a digit, a letter) a piece looks most like, or null when not sure. */
export function matchGlyph(
  v: readonly number[],
  glyphs: Readonly<Record<string, readonly (readonly number[])[]>>,
  minMatch = MIN_MATCH,
  minMargin = MIN_MARGIN,
): string | null {
  const [best, bestScore, , second] = nearestGlyphs(v, glyphs);
  if (best == null || bestScore < minMatch || bestScore - second < minMargin) return null;
  return best;
}

/** The two glyphs a piece looks most like, with their scores: [best, its score, runner-up, its score]. */
function nearestGlyphs(v: readonly number[], glyphs: Readonly<Record<string, readonly (readonly number[])[]>>): [string | null, number, string | null, number] {
  // The nearest sample of each digit (the samples differ with the background; an average blurs 0, 6 and 8 together:
  // 116 of 132 held-out digits right against 109, 2026-11-04).
  let best: string | null = null;
  let runnerUp: string | null = null;
  let bestScore = -1;
  let second = -1;
  for (const [d, samples] of Object.entries(glyphs)) {
    let dot = -1;
    for (const g of samples) {
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i]! * (g[i] ?? 0);
      if (s > dot) dot = s;
    }
    if (dot > bestScore) {
      second = bestScore;
      runnerUp = best;
      bestScore = dot;
      best = d;
    } else if (dot > second) {
      second = dot;
      runnerUp = d;
    }
  }
  return [best, bestScore, runnerUp, second];
}

/** One pitch box as found: its digit pieces (left to right, the string's full height), its minus, where it is. */
export interface PitchBox {
  digits: Rect[];
  minus: boolean;
  x: number;
  y: number;
  /** Digit height, pixels. */
  dh: number;
  /** The colour of the box's outline, when it was looked for and found (framedBy). */
  frame: Rgb | null;
}

/**
 * Pieces one above the other with a small gap, made one: a star on a digit splits it top from bottom (his +49: the
 * star's soft edge left a gap through the 4). Digits side by side never stack, so they are not joined.
 */
function joinStacked(pieces: Rect[], sh: number): Rect[] {
  /*
    Only parts short of a digit (about 1.1 % of the screen's height) can join, and only those overlapping across: sorted
    by x, each is compared with the next ones until they start right of it. Comparing every pair and restarting after
    each join took 1.5 s on a star field's hundreds of specks (2026-11-07). Specks stay in: leaving out pieces under
    3 px kept some real parts of a digit apart (his 1198 read 90 for 66).
  */
  const rest: Rect[] = [];
  const out: Rect[] = [];
  for (const p of pieces) (p.y1 - p.y0 + 1 < sh * 0.0095 ? out : rest).push({ ...p });
  out.sort((a, b) => a.x0 - b.x0);
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++)
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i]!;
        const b = out[j]!;
        if (b.x0 > a.x1) break;
        const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
        const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
        const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1) - 1;
        const tall = Math.max(a.y1, b.y1) - Math.min(a.y0, b.y0) + 1;
        // Two parts each short of a digit, together about one.
        const short = Math.max(a.y1 - a.y0, b.y1 - b.y0) + 1 < sh * 0.0095;
        if (overlap >= narrow * 0.5 && gap >= 0 && gap <= 3 && short && tall >= sh * 0.009 && tall <= sh * 0.013) {
          out[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
          out.splice(j, 1);
          merged = true;
        }
      }
  }
  return [...rest, ...out];
}

/** Split a piece wider than a digit at its thinnest columns, into as many digits as its width holds. */
function splitWide(mask: Uint8Array, w: number, c: Rect, dh: number): Rect[] {
  const cw = c.x1 - c.x0 + 1;
  const n = Math.round(cw / (dh * 0.78));
  if (n < 2) return [c];
  const out: Rect[] = [];
  let from = c.x0;
  for (let k = 1; k < n; k++) {
    const aim = c.x0 + Math.round((k * cw) / n);
    let best = aim;
    let bestN = Infinity;
    for (let x = aim - Math.round(dh * 0.2); x <= aim + Math.round(dh * 0.2); x++) {
      let m = 0;
      for (let y = c.y0; y <= c.y1; y++) if (mask[y * w + x]) m++;
      if (m < bestN) {
        bestN = m;
        best = x;
      }
    }
    out.push({ ...c, x0: from, x1: best - 1 });
    from = best + 1;
  }
  out.push({ ...c, x0: from });
  return out.filter((p) => p.x1 - p.x0 + 1 >= dh * 0.3);
}

/** A minus left of the digits: yellow across the middle rows of the gap, far less in its top and bottom rows. */
function hasMinus(rgba: Rgba, w: number, left: number, top: number, bottom: number, ink = yellowness, leftBox = false): boolean {
  const dh = bottom - top + 1;
  const mid = (top + bottom) / 2;
  const x0 = Math.round(left - dh * 0.85);
  const x1 = Math.round(left - dh * 0.1);
  let bar = 0;
  let cols = 0;
  for (let x = x0; x <= x1; x++) {
    cols++;
    let midY = 0;
    let peak = 0;
    for (let y = Math.round(mid - dh * 0.22); y <= Math.round(mid + dh * 0.22); y++) {
      const i = (y * w + x) * 4;
      const v = ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
      if (v > midY) {
        midY = v;
        peak = y;
      }
    }
    let edge = 0;
    for (const y of [top, top + 1, bottom - 1, bottom]) {
      const i = (y * w + x) * 4;
      edge = Math.max(edge, ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
    }
    // Against the bar's own ink, not a fixed edge: bright sand behind a gear-down box inks 0.33-0.44 everywhere
    // (2026-11-06, Screenshot_0325: -19 read as 19).
    // A right box's arrow points left: beside its tip the two slanted edges run both above and below the middle (his
    // 0775 "11" set upright: the tip read as a minus in the right box only). A minus is dark on at least one side: the
    // game's own stands a little low, its lower edge where the tip's would be (0007 "-14").
    const shoulders = [-1, 1].map((s) => {
      let m = 0;
      for (let y = Math.round(mid + s * dh * 0.28); y !== Math.round(mid + s * dh * 0.4) + s; y += s) {
        const i = (y * w + x) * 4;
        m = Math.max(m, ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
      }
      return m;
    });
    /*
      Or against the rows just off the bar, both darker: a box filled see-through over grey ground inks its digits' top
      and bottom rows nearly as much as a dim minus (his 1011 "-1", 0.44 against 0.67), with a dark rim round the bar.
      Only in a left box: a right box points left, and its tip, thinner there than the rows looked at, passed as a minus
      (0775 "11" set upright). A right box missing the dim minus its left box finds is not sure, never wrong.
    */
    const off = Math.max(2, Math.round(dh * 0.2));
    let rim = 0;
    for (const y of [peak - off, peak + off]) {
      const i = (y * w + x) * 4;
      rim = Math.max(rim, ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
    }
    if (midY > 0.45 && ((midY - edge > 0.3 && midY - Math.min(...shoulders) > 0.3) || (leftBox && midY - rim > 0.3))) bar++;
  }
  return cols > 0 && bar / cols >= 0.4;
}

/**
 * The box's outline: a line across the string just above it and one just below (owner's EDHM shots, 2026-11-07: the
 * ladder's labels are the boxes' grey too, but stand free). Each line is traced from above (below) the digits' middle,
 * column by column a row up or down at most, so it follows the box's tilt with the roll (a box's own tilt is not the
 * pair's: the HUD is drawn in perspective); a line pixel is brighter than the pixels 3 rows above and below it in a
 * colour channel, gaps of
 * up to 3 pixels bridged (a tilted line is drawn in dashes). Both lines must span the digits and be two digits' height
 * long. Their colour, or null.
 */
function framedBy(rgba: Rgba, w: number, h: number, box: PitchBox): Rgb | null {
  const dh = box.dh;
  const left = Math.min(...box.digits.map((c) => c.x0));
  const right = Math.max(...box.digits.map((c) => c.x1));
  const cx = Math.round((left + right) / 2);
  const top = Math.min(...box.digits.map((c) => c.y0));
  const bottom = Math.max(...box.digits.map((c) => c.y1));
  // Brighter in any one channel: a faint green line over grey ground stands out in its green only (his 0331: 52 on 28).
  const line = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 3 || y >= h - 3) return 0;
    const i = (y * w + x) * 4;
    let up = i - 3 * w * 4;
    let dn = i + 3 * w * 4;
    // A star three rows off is not the ground the line stands out from: the other side is (his 0777, a star field under
    // a box's top line).
    const star = (j: number) => isStarPx(rgba[j]!, rgba[j + 1]!, rgba[j + 2]!);
    if (star(up)) up = dn;
    else if (star(dn)) dn = up;
    if (star(up)) return 0;
    let c = 0;
    for (let k = 0; k < 3; k++) c = Math.max(c, rgba[i + k]! - Math.max(rgba[up + k]!, rgba[dn + k]!));
    return c;
  };
  const MIN = 18;
  const starAt = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    const i = (y * w + x) * 4;
    return isStarPx(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
  };
  type Pt = { x0: number; y0: number; x1: number; y1: number };
  /*
    Every row that could be the line at the digits' middle column, the strongest first, until one traces along the box: a
    star just above a box outshone its thin outline, the strongest row traced 5 px and the box counted as unframed
    (2026-11-13: his 0716 "59", and most of the 35 EDHM shots that found no framed pair were on star fields).
  */
  const trace = (ya: number, yb: number): Pt[] | null => {
    const rows: { y: number; c: number }[] = [];
    for (let y = ya; y <= yb; y++) {
      const c = line(cx, y);
      if (c >= MIN) rows.push({ y, c });
    }
    rows.sort((a, b) => b.c - a.c);
    for (const { y } of rows) {
      const pts = traceFrom(y);
      if (pts) return pts;
    }
    return null;
  };
  // A gap in the line: a star a few rows off it dims the line's contrast for its width (his 0775, 4 px).
  const maxGap = Math.max(3, Math.round(dh * 0.3));
  const traceFrom = (y0: number): Pt[] | null => {
    let x0 = cx;
    let x1 = cx;
    const pts: Pt[] = [{ x0: cx, y0, x1: cx, y1: y0 }];
    for (const dir of [-1, 1]) {
      let y = y0;
      let gap = 0;
      for (let x = cx + dir; x >= 0 && x < w && gap <= maxGap; x += dir) {
        /*
          The row it is on while that holds, a row up or down only when that is a quarter brighter, and never onto a star
          (unless the line is star-white itself): the brightest of the three let a brighter neighbour pull the trace off
          the line (his 0371, 1146, 1147 read now). Staying on the row whenever it held lost a box drawn in perspective,
          its line a row lower every few pixels (his 0955); a half brighter or twice swapped one shot for another.
        */
        const here = line(x, y);
        const held = here >= MIN;
        let by = y;
        let bc = held ? here : MIN - 1;
        for (const yy of [y - 1, y + 1]) {
          if (held && starAt(x, yy) && !starAt(x, y)) continue;
          const c = line(x, yy);
          if (held ? c > here * 1.25 && c > bc : c > bc) {
            bc = c;
            by = yy;
          }
        }
        if (bc < MIN) {
          gap++;
          continue;
        }
        gap = 0;
        y = by;
        pts.push({ x0: x, y0: y, x1: x, y1: y });
        if (dir < 0) x0 = x;
        else x1 = x;
      }
    }
    return x0 <= left && x1 >= right && x1 - x0 + 1 >= dh * 2 ? pts : null;
  };
  /*
    Clear of the digits' own soft edge: a tenth of a digit (was a fifth; his 0371 theme draws the box tight, its top line
    0.19 of a digit above the digits). Their glow does not pass for a line: it is not brighter than the digit 3 rows on.
  */
  const above = trace(Math.round(top - dh), Math.round(top - dh * 0.1));
  const below = above && trace(Math.round(bottom + dh * 0.1), Math.round(bottom + dh));
  return above && below ? strokeColour(rgba, w, [...above, ...below]) : null;
}

/**
 * Nothing of the number left unread in a left box (his EDHM shots, 2026-11-07, both boxes alike: "-31" read 1, "66" read
 * 6, "-74" read 74). Each column's most ink in the top, middle and bottom third of the digits' rows. Left of the digits
 * read, a run inked in the top and the bottom third is a digit lost; with no minus read, a run inked in one third only
 * is a minus lost (a rolled box tilts it out of the middle). Right of them, before the arrow, a run inked in all three
 * thirds is a digit lost (the arrow's strokes leave the middle empty). Runs of a third of a digit's height count. The
 * left box only: the right one's arrow points left, beside its digits.
 */
function nothingLeftOut(rgba: Rgba, w: number, box: PitchBox, ink: (r: number, g: number, b: number) => number): boolean {
  const dh = box.dh;
  const left = Math.min(...box.digits.map((c) => c.x0));
  const right = Math.max(...box.digits.map((c) => c.x1));
  const top = Math.min(...box.digits.map((c) => c.y0));
  const bottom = Math.max(...box.digits.map((c) => c.y1));
  const third = (bottom - top + 1) / 3;
  // Each third's most ink over its least: the same as its most on a dark ground, but a grey theme's ink is high on grey
  // ground too (his 0973: the ground left of "82" read as a lost digit), where a digit still shows by its dark rim.
  const thirds = (x: number): [number, number, number] => {
    const most: [number, number, number] = [0, 0, 0];
    const least: [number, number, number] = [1, 1, 1];
    for (let y = top; y <= bottom; y++) {
      const i = (y * w + x) * 4;
      const k = y < top + third ? 0 : y > bottom - third ? 2 : 1;
      const v = ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
      most[k] = Math.max(most[k], v);
      least[k] = Math.min(least[k], v);
    }
    return [most[0] - least[0], most[1] - least[1], most[2] - least[2]];
  };
  const run = dh * 0.3;
  // A lost digit or minus stands next to the digits read; the box's own side is further out.
  let digitRun = 0;
  let barRun = 0;
  for (let x = Math.max(0, Math.round(left - dh * 0.8)); x < Math.round(left - dh * 0.1); x++) {
    const [hi, mid, lo] = thirds(x);
    digitRun = hi > 0.4 && lo > 0.4 ? digitRun + 1 : 0;
    barRun = [hi, mid, lo].filter((v) => v > 0.4).length === 1 && Math.min(hi, mid, lo) < 0.2 ? barRun + 1 : 0;
    if (digitRun >= run || (!box.minus && barRun >= run)) return false;
  }
  digitRun = 0;
  for (let x = Math.round(right + dh * 0.1); x < Math.min(w, Math.round(right + dh * 0.8)); x++) {
    const [hi, mid, lo] = thirds(x);
    digitRun = hi > 0.4 && mid > 0.4 && lo > 0.4 ? digitRun + 1 : 0;
    if (digitRun >= run) return false;
  }
  return true;
}

/**
 * The frame may be a crop round the screen's centre (the capture reads only the middle): `screen` is the whole
 * screen's size, which the HUD's proportions are measured in. The crop's centre is the screen's.
 */
export interface FrameScreen {
  w: number;
  h: number;
}

/**
 * The pitch boxes in an RGBA frame `w` x `h`: the mirrored pair of yellow number strings about the centre. `framed`:
 * only strings with the box's outline round them (a recoloured HUD, whose ladder labels are the digits' colour).
 */
export function findPitchBoxes(
  rgba: Rgba,
  w: number,
  h: number,
  screen: FrameScreen = { w, h },
  look: HudStyleName | TextLook = "yellow",
  framed = false,
): { left: PitchBox; right: PitchBox } | null {
  const found = lookBoxes(rgba, w, h, screen, look);
  return found && pitchPair(framed ? framedOnly(rgba, w, h, found) : found, w, h, screen);
}

/** The boxes with the box's outline round them, the outline found. */
function framedOnly(rgba: Rgba, w: number, h: number, found: PitchBox[]): PitchBox[] {
  return found.filter((b) => b.digits.length).map((b) => ({ ...b, frame: framedBy(rgba, w, h, b) })).filter((b) => b.frame);
}

/**
 * Every number string in a look, as a box without its outline; null when the look marks too much of the frame. The
 * framed and the plain search share them: building them twice was half of an unread frame's time. `band`: only there,
 * and however much of it the look marks (a pair already found; see pitchPairsAnyColour).
 */
function lookBoxes(rgba: Rgba, w: number, h: number, screen: FrameScreen, look: HudStyleName | TextLook, band?: Rect): PitchBox[] | null {
  const style = lookOf(look);
  const sw = screen.w;
  const sh = screen.h;
  const mask = scratchMask("look", w * h);
  // The middle 40 % of the screen, either way (or all of a crop that is no bigger).
  const rx0 = Math.max(0, Math.floor(w / 2 - sw * 0.2), band ? band.x0 : 0);
  const rx1 = Math.min(w, Math.ceil(w / 2 + sw * 0.2), band ? band.x1 : w);
  const ry0 = Math.max(0, Math.floor(h / 2 - sh * 0.2), band ? band.y0 : 0);
  const ry1 = Math.min(h, Math.ceil(h / 2 + sh * 0.2), band ? band.y1 : h);
  if (rx1 <= rx0 || ry1 <= ry0) return null;
  for (let y = ry0; y < ry1; y++) mask.fill(0, y * w + rx0, y * w + rx1);
  let marked = 0;
  for (let y = ry0; y < ry1; y++)
    for (let x = rx0; x < rx1; x++) {
      const i = y * w + x;
      if (style.isText(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!) || isStarPx(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)) {
        mask[i] = 1;
        marked++;
      }
    }
  if (!band && marked > (rx1 - rx0) * (ry1 - ry0) * MAX_TEXT_SHARE) return null;
  const minH = Math.max(5, sh * 0.007);
  const maxH = sh * 0.03;
  const raw = splitJoined(components(mask, w, rx0, ry0, rx1, ry1), mask, w, minH, maxH);
  const sized = joinStacked(raw, sh).filter((c) => {
    const ch = c.y1 - c.y0 + 1;
    // At full size the box's own straight edges are as bright as its digits: a digit is never that thin, nor that wide.
    const cw = c.x1 - c.x0 + 1;
    return ch >= minH && ch <= maxH && cw >= ch * 0.15 && cw <= ch * 2.2;
  });
  // A piece round others is a box's outline drawn in its digits' colour (his EDHM cyan theme, 2026-11-07), not a digit.
  const tall = sized.filter((c) => !sized.some((o) => o !== c && o.x0 > c.x0 && o.x1 < c.x1 && o.y0 > c.y0 && o.y1 < c.y1));
  tall.sort((a, b) => a.x0 - b.x0);
  // Strings: tall pieces on one row, close together.
  const strings: Rect[][] = [];
  for (const c of tall) {
    const cy = (c.y0 + c.y1) / 2;
    const ch = c.y1 - c.y0 + 1;
    const s = strings.find((g) => {
      const last = g[g.length - 1]!;
      return Math.abs((last.y0 + last.y1) / 2 - cy) < ch * 0.4 && c.x0 - last.x1 < ch * 0.9;
    });
    if (s) s.push(c);
    else strings.push([c]);
  }
  const found: PitchBox[] = strings.map((all) => {
    const tallOf = (c: Rect) => c.y1 - c.y0 + 1;
    /*
      The box's own side can join the string too, far taller than the digits and thin as a line (his 0981, a dim grey
      theme: the right box's side with a star on it, 5 x 27 beside a 14-high "26", set the height and the digits were
      dropped as arrow strokes). A lone piece over 1.5 times the next tallest and under 0.3 of its own height wide is
      left out (the narrowest labelled 1 is 0.47).
    */
    const byHeight = [...all].sort((a, b) => tallOf(b) - tallOf(a));
    const side =
      byHeight.length > 1 && tallOf(byHeight[0]!) > 1.5 * tallOf(byHeight[1]!) && byHeight[0]!.x1 - byHeight[0]!.x0 + 1 < 0.3 * tallOf(byHeight[0]!)
        ? byHeight[0]
        : null;
    // The box's arrow strokes sit on the digits' row but are shorter than them.
    const tallest = Math.max(...all.filter((c) => c !== side).map(tallOf));
    const g = all.filter((c) => c !== side && tallOf(c) >= tallest * 0.75);
    /*
      A star on one digit's end (his 0671: below the first 2 of "22", that piece 19 rows to the other's 15) does not set
      the digits' rows: a lone end two or more rows past every other digit's, each of those rows inked across under
      0.45 of its piece's width, is left out (cut off by the digits' rows below), when what is left is still a digit's
      height: else the short one lost rows (a dim theme's 6 of "66", his 0975, kept whole).
    */
    const narrow = (c: Rect, ya: number, yb: number) => {
      for (let y = ya; y <= yb; y++) {
        let n = 0;
        for (let x = c.x0; x <= c.x1; x++) if (mask[y * w + x]) n++;
        if (n > (c.x1 - c.x0 + 1) * 0.45) return false;
      }
      return true;
    };
    const lows = g.map((c) => c.y1).sort((a, b) => b - a);
    const highs = g.map((c) => c.y0).sort((a, b) => a - b);
    const lowOne = g.filter((c) => c.y1 === lows[0]);
    const highOne = g.filter((c) => c.y0 === highs[0]);
    const full = (y0: number, y1: number) => y1 - y0 + 1 >= sh * 0.0095;
    const cutLow = g.length > 1 && lowOne.length === 1 && lows[0]! - lows[1]! >= 2 && full(highs[0]!, lows[1]!) && narrow(lowOne[0]!, lows[1]! + 1, lows[0]!);
    const bottom = cutLow ? lows[1]! : lows[0]!;
    const cutHigh = g.length > 1 && highOne.length === 1 && highs[1]! - highs[0]! >= 2 && full(highs[1]!, bottom) && narrow(highOne[0]!, highs[0]!, highs[1]! - 1);
    const top = cutHigh ? highs[1]! : highs[0]!;
    const left = Math.min(...g.map((c) => c.x0));
    const right = Math.max(...g.map((c) => c.x1));
    const dh = bottom - top + 1;
    const digits = g.flatMap((p) => splitWide(mask, w, { ...p, y0: top, y1: bottom }, dh));
    return { digits, minus: hasMinus(rgba, w, left, top, bottom, style.ink, right < w / 2), x: (left + right) / 2, y: (top + bottom) / 2, dh, frame: null };
  });
  return found;
}

/**
 * A piece wider than a digit pair may be an outline its digits are joined to (the cyan theme) or digits with the minus
 * joined on: its digits take its place. Not when it holds a digit-tall piece already (a plain outline; a minus inside
 * does not count, it stays apart where the digits met the outline). Size first: a star field is hundreds of specks.
 */
function splitJoined(pieces: Rect[], mask: Uint8Array, w: number, minH: number, maxH: number): Rect[] {
  const holdsDigit = (c: Rect) => pieces.some((o) => o !== c && o.x0 > c.x0 && o.x1 < c.x1 && o.y0 > c.y0 && o.y1 < c.y1 && o.y1 - o.y0 + 1 >= minH);
  return pieces.flatMap((c) => {
    const ch = c.y1 - c.y0 + 1;
    if (ch < minH || c.x1 - c.x0 + 1 <= ch * 1.3 || holdsDigit(c)) return [c];
    // The digits inside an outline can have their minus joined on too (his 0938 "-53").
    const inside = digitsInOutline(mask, w, c, minH, maxH);
    if (inside) return inside.flatMap((p) => peelMinus(mask, w, p, minH, maxH) ?? [p]);
    return peelMinus(mask, w, c, minH, maxH) ?? [c];
  });
}

/**
 * The digits inside a pitch box whose outline they are joined to (2026-11-13: his cyan theme, 0759: the 3 of "-73" met
 * the slanted edge of the box's point, digits and outline one 65 x 27 piece, dropped as too wide). The outline (its top
 * and bottom runs, and each row's first and last few pixels: its sides, square or slanted) is left out and the pieces
 * inside found again. Only for a piece with long runs along its top and bottom rows, and only when a digit-tall piece
 * is left inside: else null and the piece stays as it was.
 */
function digitsInOutline(mask: Uint8Array, w: number, c: Rect, minH: number, maxH: number): Rect[] | null {
  const cw = c.x1 - c.x0 + 1;
  const ch = c.y1 - c.y0 + 1;
  // Wider than a digit pair, or narrower when taller than any digit (a box round one or two narrow digits: his "11").
  if (ch < minH * 1.2 || ch > maxH * 1.5 || cw <= ch * (ch >= minH * 2.2 ? 1.5 : 2.2) || cw > ch * 6) return null;
  // An outline runs along its top and bottom rows (within a fifth of its height: a star can hang on below it, his
  // 0775); a string of digits (a minus joined on, his -84) does not.
  const longRun = (y: number) => {
    let run = 0;
    for (let x = c.x0; x <= c.x1; x++) if ((run = mask[y * w + x] ? run + 1 : 0) >= cw * 0.5) return true;
    return false;
  };
  const edge = Math.max(2, Math.round(ch / 5));
  let top = false;
  let bottom = false;
  for (let k = 0; k < edge && !(top && bottom); k++) {
    top ||= longRun(c.y0 + k);
    bottom ||= longRun(c.y1 - k);
  }
  if (!top || !bottom) return null;
  const inner = scratchMask("inner", mask.length);
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) inner[y * w + x] = mask[y * w + x]!;
  // The outline's lines: on each row its first and last few pixels (the box's sides, square or slanted to its point; a
  // digit that met them keeps the rest of the row), and the rows its top and bottom run along (a run over half its width).
  const side = Math.max(3, Math.round(ch / 6));
  for (let y = c.y0; y <= c.y1; y++) {
    const row = y * w;
    let a = c.x0;
    while (a <= c.x1 && !mask[row + a]) a++;
    if (a > c.x1) continue;
    let b = c.x1;
    while (!mask[row + b]) b--;
    for (let x = a; x <= c.x1; ) {
      if (!mask[row + x]) { x++; continue; }
      let e = x;
      while (e + 1 <= c.x1 && mask[row + e + 1]) e++;
      if (e - x + 1 >= cw * 0.5) inner.fill(0, row + x, row + e + 1);
      x = e + 1;
    }
    for (let x = a; x < a + side && x <= c.x1 && mask[row + x]; x++) inner[row + x] = 0;
    for (let x = b; x > b - side && x >= c.x0 && mask[row + x]; x--) inner[row + x] = 0;
  }
  // The same down each column from a top or bottom line, where its run starts at the outline (a star on a digit's top
  // joined it to the line: his 0775 "11", rolled and set upright).
  for (let x = c.x0; x <= c.x1; x++) {
    let a = c.y0;
    while (a <= c.y1 && !mask[a * w + x]) a++;
    if (a > c.y0 + edge) continue;
    for (let y = a; y < a + side && y <= c.y1 && mask[y * w + x]; y++) inner[y * w + x] = 0;
    let b = c.y1;
    while (b >= c.y0 && !mask[b * w + x]) b--;
    if (b < c.y1 - edge) continue;
    for (let y = b; y > b - side && y >= c.y0 && mask[y * w + x]; y--) inner[y * w + x] = 0;
  }
  // What is left of the outline (its pointed end is slanted, no long run) still reaches the piece's edge; a digit inside never does.
  // Whole numbers made so (`| 0`): a piece's edges come out of a division, and one call with them turned components()
  // over to fractions for every later call, 10 ms more each read (measured 2026-11-13, 42 -> 52 ms).
  const found = components(inner, w, c.x0 | 0, c.y0 | 0, (c.x1 + 1) | 0, (c.y1 + 1) | 0).filter((p) => p.x0 > c.x0 && p.x1 < c.x1 && p.y0 > c.y0 && p.y1 < c.y1);
  const digitTall = found.filter((p) => p.y1 - p.y0 + 1 >= Math.max(minH, ch * 0.45));
  return digitTall.length >= 1 ? found : null;
}

/**
 * A minus joined to the digits right of it (2026-11-13, his cyan theme, 0754: "-36" one piece through the glow, a pixel
 * too wide for a digit pair): from the left, columns inked only across the middle rows are the bar; the digits start at
 * the first column whose ink is not a bar's (his -84: one piece narrow enough to pass, the bar split off as a
 * fourth "digit"). Null unless there is such a bar, wider than any digit's slanted stroke, and digits after it.
 */
function peelMinus(mask: Uint8Array, w: number, c: Rect, minH: number, maxH: number): Rect[] | null {
  const cw = c.x1 - c.x0 + 1;
  const ch = c.y1 - c.y0 + 1;
  if (ch < minH || ch > maxH || cw <= ch * 1.3 || cw > ch * 3.6) return null;
  // A column of the bar: its ink at most half the piece's height, its middle between 0.3 and 0.75 of it (the game's
  // minus stands low, and a glowing one is thick: his 1103 "-36", 0938 "-53" 7 rows of 20); an empty one carries on.
  const notBar = (x: number) => {
    let top = -1;
    let bottom = -1;
    for (let y = c.y0; y <= c.y1; y++)
      if (mask[y * w + x]) {
        if (top < 0) top = y;
        bottom = y;
      }
    if (top < 0) return false;
    const mid = (top + bottom) / 2 - c.y0;
    return bottom - top + 1 > ch * 0.5 || mid < ch * 0.3 || mid > ch * 0.75;
  };
  let x = c.x0;
  while (x <= c.x1 && !notBar(x)) x++;
  if (x - c.x0 < ch * 0.4 || c.x1 - x + 1 < ch * 0.5) return null;
  // The bar as tall as its ink (a minus, too short for a digit), the digits as tall as the piece.
  let y0 = c.y1;
  let y1 = c.y0;
  for (let y = c.y0; y <= c.y1; y++)
    for (let k = c.x0; k < x; k++)
      if (mask[y * w + k]) {
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return [{ x0: c.x0, y0, x1: x - 1, y1 }, { ...c, x0: x }];
}

/** The pair: mirrored about the centre (the boxes stand either side of the nose), the same size. */
function pitchPair(boxes: PitchBox[], w: number, h: number, screen: FrameScreen): { left: PitchBox; right: PitchBox } | null {
  const sw = screen.w;
  const sh = screen.h;
  let best: { left: PitchBox; right: PitchBox } | null = null;
  let bestErr = Infinity;
  for (const l of boxes)
    for (const r of boxes) {
      if (l.x >= w / 2 || r.x <= w / 2) continue;
      if (l.x < w / 2 - sw * 0.14 || r.x > w / 2 + sw * 0.14) continue;
      const midX = (l.x + r.x) / 2 - w / 2;
      const midY = (l.y + r.y) / 2 - h / 2;
      if (Math.abs(midX) > sw * 0.02 || Math.abs(midY) > sh * 0.12 || Math.abs(l.dh - r.dh) > Math.max(3, l.dh * 0.6)) continue;
      const err = Math.abs(midX) + Math.abs(midY);
      if (err < bestErr) {
        bestErr = err;
        best = { left: l, right: r };
      }
    }
  return best;
}

/**
 * Which of 6, 8 and 9 a digit is by its strokes, for two of them its glyph cannot tell apart (2026-11-13: 49 of 742
 * labelled shots were not sure only for that; a glow fills a 6's gap or a 9's). Each row's brightest pixel (raw: a
 * theme's ink saturates in the glow) in the digit's right third and in its left third: a 6's right stroke dips in its
 * upper part, a 9's left stroke in its lower part, an 8's run full on both sides. Dip below 0.90 of the stroke's own
 * other part, full above 0.985 (measured on the labelled shots read right); between, or anything else, null. 0 is left
 * out: this font's 0 is not hollow in its middle either. On the 49: 28 right, 0 wrong, 21 still not sure.
 */
function strokeDigit(rgba: Rgba, w: number, c: Rect): "6" | "8" | "9" | null {
  const cw = c.x1 - c.x0 + 1;
  const ch = c.y1 - c.y0 + 1;
  const profile = (fx0: number, fx1: number) => {
    const out: number[] = [];
    for (let y = c.y0; y <= c.y1; y++) {
      let m = 0;
      for (let x = Math.round(c.x0 + fx0 * cw); x <= Math.round(c.x0 + fx1 * cw); x++) {
        const i = (y * w + x) * 4;
        m = Math.max(m, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
      }
      out.push(m);
    }
    return out;
  };
  const part = (p: number[], f0: number, f1: number) => p.slice(Math.round(f0 * (ch - 1)), Math.round(f1 * (ch - 1)) + 1);
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]!;
  const right = profile(0.65, 1);
  const left = profile(0, 0.35);
  const state = (v: number) => (v <= 0.9 ? "dip" : v >= 0.985 ? "full" : null);
  const upperRight = state(Math.min(...part(right, 0.22, 0.45)) / Math.max(1, median(part(right, 0.55, 0.85))));
  const lowerLeft = state(Math.min(...part(left, 0.55, 0.78)) / Math.max(1, median(part(left, 0.15, 0.45))));
  if (upperRight === "dip" && lowerLeft === "full") return "6";
  if (upperRight === "full" && lowerLeft === "dip") return "9";
  if (upperRight === "full" && lowerLeft === "full") return "8";
  return null;
}

/**
 * 0 or 8 by the stroke across the middle, for the two when their glyphs score about the same (2026-11-13: 10 labelled
 * shots not sure for that; the glow fills an 8's two holes and this font's 0 is slashed, upper right to lower left).
 * Read in the box's channel of widest spread (a glowing theme saturates the others), scaled to its own p10..p90:
 * - slope: each inner column's brightest row in the middle rows, fitted: the slash falls to the left (about -0.7), the
 *   8's bar runs flat (about 0);
 * - diag: the slash lights the upper-right and lower-left quarters of the hollow, the holes stay dark in the other two;
 *   an 8's four quarters alike;
 * - bar: the middle row near both sides, ink on an 8 (its bar meets the outline), hollow on a 0.
 * A 0 must show all three, an 8 too; else null. Measured on 433 labelled 0s and 8s: every one on the wrong side of at
 * least one. A 9 shows an 8's three as well (its middle bar), so readBox takes an 8 only with the strokes' 8 beside it;
 * no labelled 6 or 9 shows a 0's. Labelled shots 665 -> 675 right, theme bench 3,237 -> 3,305 right, 0 wrong.
 */
function slashDigit(rgba: Rgba, w: number, c: Rect): "0" | "8" | null {
  const cw = c.x1 - c.x0 + 1;
  const ch = c.y1 - c.y0 + 1;
  if (cw < 6 || ch < 9) return null;
  let channel = 0;
  let lo = 0;
  let spread = -1;
  const v = new Array<number>(cw * ch);
  for (let k = 0; k < 3; k++) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) v[y * cw + x] = rgba[((c.y0 + y) * w + c.x0 + x) * 4 + k]!;
    v.sort((a, b) => a - b);
    const p10 = v[Math.floor(v.length * 0.1)]!;
    const p90 = v[Math.floor(v.length * 0.9)]!;
    if (p90 - p10 > spread) {
      spread = p90 - p10;
      channel = k;
      lo = p10;
    }
  }
  if (spread < 16) return null;
  const px = (x: number, y: number) => rgba[(y * w + x) * 4 + channel]!;
  const at = (fx: number, fy: number) => {
    const x = c.x0 + fx * (cw - 1);
    const y = c.y0 + fy * (ch - 1);
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const ax = x - xi;
    const ay = y - yi;
    return (
      (px(xi, yi) * (1 - ax) + px(xi + 1, yi) * ax) * (1 - ay) + (px(xi, yi + 1) * (1 - ax) + px(xi + 1, yi + 1) * ax) * ay
    );
  };
  const spot = (fx: number, fy: number) => {
    let s = 0;
    for (const dx of [-0.05, 0, 0.05]) for (const dy of [-0.03, 0, 0.03]) s += at(fx + dx, fy + dy);
    return (s / 9 - lo) / spread;
  };
  const diag = spot(0.62, 0.32) + spot(0.38, 0.68) - spot(0.38, 0.32) - spot(0.62, 0.68);
  const bar = (spot(0.3, 0.5) + spot(0.7, 0.5)) / 2;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let x = Math.round(c.x0 + 0.28 * cw); x <= Math.round(c.x0 + 0.72 * cw) - 1; x++) {
    let best = -1;
    let row = 0;
    for (let y = Math.round(c.y0 + 0.22 * ch); y <= Math.round(c.y0 + 0.78 * ch) - 1; y++)
      if (px(x, y) > best) {
        best = px(x, y);
        row = y;
      }
    const fx = (x - c.x0) / cw;
    const fy = (row - c.y0) / ch;
    n++;
    sx += fx;
    sy += fy;
    sxy += fx * fy;
    sxx += fx * fx;
  }
  const den = n * sxx - sx * sx;
  if (n < 3 || den <= 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  if (slope <= -0.4 && diag >= 0.45 && bar <= 0.92) return "0";
  if (slope >= -0.25 && diag <= 0.4 && bar >= 0.95) return "8";
  return null;
}

/** A box's number, or null when a digit is not sure. */
export function readBox(
  rgba: Rgba,
  w: number,
  b: PitchBox,
  glyphs: PitchGlyphs,
  look: HudStyleName | TextLook = "yellow",
  minMatch = MIN_MATCH,
  minMargin = MIN_MARGIN,
): number | null {
  if (!b.digits.length || b.digits.length > 2) return null;
  const ink = lookOf(look).ink;
  let text = "";
  for (const c of b.digits) {
    const [best, score, runnerUp, second] = nearestGlyphs(glyphVector(rgba, w, c, GLYPH_W, GLYPH_H, ink), glyphs);
    let d = best != null && score >= minMatch && score - second >= minMargin ? best : null;
    // Two of 6, 8 and 9 about as close: the strokes tell, when they do.
    if (d == null && best != null && runnerUp != null && score >= minMatch && "689".includes(best) && "689".includes(runnerUp)) {
      const s = strokeDigit(rgba, w, c);
      if (s === best || s === runnerUp) d = s;
    }
    // 0 and 8 about as close: the stroke across the middle tells, when it does. A 9 can score as 0 and 8 (its middle
    // bar is an 8's): an 8 also needs the strokes' 8, whose lower left is closed.
    if (d == null && best != null && runnerUp != null && score >= minMatch && [best, runnerUp].sort().join("") === "08") {
      const s = slashDigit(rgba, w, c);
      if (s === "0" || (s === "8" && strokeDigit(rgba, w, c) === "8")) d = s;
    }
    if (d == null) return null;
    text += d;
  }
  const value = Number(text) * (b.minus ? -1 : 1);
  return Math.abs(value) <= 90 ? value : null;
}

/**
 * Read the HUD's pitch from an RGBA frame `w` x `h`; null when it cannot be sure. `glyphs`: digit to glyph vector
 * (hudPitchGlyphs.ts). Both boxes must read the same number (in full-size frames both read clean).
 */
export function readHudPitch(
  rgba: Rgba,
  w: number,
  h: number,
  glyphs: HudGlyphs,
  screen: FrameScreen = { w, h },
  framings: readonly boolean[] = [true, false],
  /** Each look's boxes, kept between calls on the same frame (readHudPitchAnyColour tries the framed, later the plain). */
  seen?: Map<HudStyleName, PitchBox[] | null>,
): PitchReading | null {
  for (const styleName of ["yellow", "orange"] as const) {
    const g = glyphs[styleName];
    if (!g) continue;
    // The boxes with their outline first: the ladder's "0" labels are a mirrored pair too, nearer the centre than the
    // boxes when the nose is just under the horizon (his 0010, "-1" read 0); the plain nearest pair stays the fallback.
    const found = seen?.has(styleName) ? seen.get(styleName)! : lookBoxes(rgba, w, h, screen, styleName);
    seen?.set(styleName, found);
    if (!found) continue;
    for (const framed of framings) {
      const pair = pitchPair(framed ? framedOnly(rgba, w, h, found) : found, w, h, screen);
      const r = pair && readPair(rgba, w, h, screen, pair, g, styleName, styleName, isLadderPx);
      if (r) return r;
    }
  }
  return null;
}

/** Both boxes of a pair read, the same, and the fraction from the ladder; null when not sure. */
function readPair(
  rgba: Rgba,
  w: number,
  h: number,
  screen: FrameScreen,
  pair: { left: PitchBox; right: PitchBox },
  glyphs: PitchGlyphs,
  look: HudStyleName | TextLook,
  style: PitchReading["style"],
  isLadder: (r: number, g: number, b: number) => boolean,
  minMatch = MIN_MATCH,
  minMargin = MIN_MARGIN,
): PitchReading | null {
  // A recoloured HUD's boxes: its learned colour can lose a dim digit or a tilted minus in both boxes at once. The left
  // box only: the right one's arrow points left, beside its digits.
  if (style === "learned" && !nothingLeftOut(rgba, w, pair.left, lookOf(look).ink)) return null;
  const l = readBox(rgba, w, pair.left, glyphs, look, minMatch, minMargin);
  const r = readBox(rgba, w, pair.right, glyphs, look, minMatch, minMargin);
  // Both, the same: a digit with no glyph yet is read as its nearest neighbour (a 6 as a 9, 2026-11-04 test), and two
  // boxes agreeing on a wrong number is far rarer than one box being wrong.
  if (l == null || r == null || l !== r) return null;
  const rollDeg = (Math.atan2(pair.right.y - pair.left.y, pair.right.x - pair.left.x) * 180) / Math.PI;
  const found = refineFromLadder(rgba, w, h, pair.left, l, rollDeg, screen.h * 0.01757, isLadder);
  // No rungs: the middle of the degree the box stands for (it drops the fraction: -9 is -9.0 to -9.99).
  const mid = l === 0 ? 0 : l + 0.5 * Math.sign(l);
  // A rung missed doubles the spacing (his -3 came out -1.8): the spacing must be the screen's (25.3 px a degree at
  // 1440 rows, measured on 30 of his shots, within a fifth), and the result inside the box's own degree.
  const lo = l < 0 ? l - 1 : l === 0 ? -1 : l;
  const hi = l < 0 ? l : l === 0 ? 1 : l + 1;
  const plausible =
    !!found && Math.abs(found.pxPerDeg / (screen.h * 0.01757) - 1) <= 0.2 && found.pitchDeg >= lo - 0.15 && found.pitchDeg <= hi + 0.15;
  const fine = plausible ? { ...found!, pitchDeg: Math.max(lo + 0.05, Math.min(hi - 0.05, found!.pitchDeg)) } : null;
  return {
    pitchDeg: fine ? fine.pitchDeg : mid,
    rollDeg,
    boxes: 2,
    boxDeg: l,
    pxPerDeg: fine ? fine.pxPerDeg : null,
    style,
    centre: { x: (pair.left.x + pair.right.x) / 2, y: (pair.left.y + pair.right.y) / 2 },
  };
}

/** A recoloured HUD's pitch box colours: its digits' and its outline's (the ladder's rungs are drawn like the outline). */
export interface PitchColours {
  text: Rgb;
  frame: Rgb;
}

/*
  Strict, then soft: his green theme's gear-up digits are a dim grey (strokes 120-160), its gear-down ones white.
*/
const PITCH_FINDING_LOOKS: readonly TextLook[] = [findingLook(170, 90), findingLook(115, 60)];

type Pair = { left: PitchBox; right: PitchBox };

/**
 * Each framed mirrored pair found, with its colours: in the hue the mod's settings name (`hint`, EDHM's ini) when given,
 * and colour-blind only when that finds none (the hint saves the two blind sweeps, and a stale one costs one sweep).
 */
function discoverPitchPairs(
  rgba: Rgba,
  w: number,
  h: number,
  screen: FrameScreen,
  hint?: PitchColours | null,
): { colours: PitchColours; pair: Pair; hinted: boolean }[] {
  const out: { colours: PitchColours; pair: Pair; hinted: boolean }[] = [];
  const hinted = hint ? findPitchBoxes(rgba, w, h, screen, hueLook(hint.text), true) : null;
  if (hinted) {
    const text = strokeColour(rgba, w, [...hinted.left.digits, ...hinted.right.digits]);
    out.push({ colours: { text, frame: hinted.left.frame! }, pair: hinted, hinted: true });
    return out;
  }
  for (const finding of PITCH_FINDING_LOOKS) {
    const pair = findPitchBoxes(rgba, w, h, screen, finding, true);
    if (!pair) continue;
    const text = strokeColour(rgba, w, [...pair.left.digits, ...pair.right.digits]);
    if (!out.some((o) => sameColour(o.colours.text, text))) out.push({ colours: { text, frame: pair.left.frame! }, pair, hinted: false });
  }
  return out;
}

/** The colours a recoloured HUD draws its pitch boxes in: each framed mirrored pair found colour-blind gives one. */
export function discoverPitchColours(
  rgba: Rgba,
  w: number,
  h: number,
  screen: FrameScreen = { w, h },
  hint?: PitchColours | null,
): PitchColours[] {
  return discoverPitchPairs(rgba, w, h, screen, hint).map((p) => p.colours);
}

/** A box found colour-blind, its minus told in the learned colour's ink. */
function minusIn(rgba: Rgba, w: number, b: PitchBox, look: TextLook): PitchBox {
  const top = Math.min(...b.digits.map((c) => c.y0));
  const bottom = Math.max(...b.digits.map((c) => c.y1));
  return { ...b, minus: hasMinus(rgba, w, Math.min(...b.digits.map((c) => c.x0)), top, bottom, look.ink, b.x < w / 2) };
}

/**
 * The any-colour table's least match (as the distance reader's: a lower one let a wrong digit through), and how far ahead
 * of the next digit: his cyan theme's slashed 0 read as 8 at 0.04 (a 40 read 48, held out); 0.05 and up none wrong,
 * 0.06 for room (165 right, 158 not sure, 0 wrong of 323 held out, 2026-11-07).
 */
const ANY_MIN_MATCH = 0.85;
const ANY_MIN_MARGIN = 0.06;

/**
 * The pitch in any HUD colour, as `readAnyColourUpright` reads it; a frame it cannot read, when the ship is rolled, set
 * upright first and read again (2026-11-13: his cyan shots 0775 / 0777, rolled 9 degrees: the boxes' slanted lines ran
 * through their digits and nothing read). The roll and the HUD's centre come back in the frame's own terms.
 */
export function readHudPitchAnyColour(
  rgba: Rgba,
  w: number,
  h: number,
  glyphs: HudGlyphs,
  anyGlyphs: PitchGlyphs,
  screen: FrameScreen = { w, h },
  known?: PitchColours | null,
  discover = true,
  hint?: PitchColours | null,
): { reading: PitchReading; colours: PitchColours | null } | null {
  const found = readAnyColourUpright(rgba, w, h, glyphs, anyGlyphs, screen, known, discover, hint);
  /*
    Read tilted, a box's minus leaves the middle rows it is looked for in: the roll the boxes give is checked upright
    (theme bench 2026-11-13: his 1116 "-74", rolled 8 degrees, read 74 in nine themes; upright, -74 in all). Unread,
    the roll comes from the ladder.
  */
  // A tilted read with its minus seen needs no check (and the check can lose a digit: 1043 "-24" in a gold theme read
  // 4 upright). Unread, only on the frames that search for colours or know them (the capture's others take the game's
  // look only).
  const tilted = found && Math.abs(found.reading.rollDeg) >= 3 && found.reading.boxDeg >= 0;
  const roll = found ? (tilted ? found.reading.rollDeg : null) : discover || known ? ladderRoll(rgba, w, h, screen) : null;
  if (roll == null) return found;
  // Turned pixel for pixel first, then blended: each reads shots the other does not (1207 the first, 0775 the second).
  let again: ReturnType<typeof readAnyColourUpright> = null;
  for (const blend of [false, true]) {
    again = readAnyColourUpright(turnedFrame(rgba, w, h, roll, blend), w, h, glyphs, anyGlyphs, screen, known, discover, hint);
    if (again) break;
  }
  // A tilted read without its minus, not read upright, is not sure (his 1116 in a dark purple theme: -74 read 74); read
  // both ways, they must agree.
  if (!again || (found && found.reading.boxDeg !== again.reading.boxDeg)) return null;
  const a = (roll * Math.PI) / 180;
  const dx = again.reading.centre.x - w / 2;
  const dy = again.reading.centre.y - h / 2;
  const centre = { x: w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  return { ...again, reading: { ...again.reading, rollDeg: again.reading.rollDeg + roll, centre } };
}

/**
 * The ship's roll from the pitch ladder, degrees as `PitchReading.rollDeg`; null when the HUD looks level. The ladder
 * turns with the roll, its short dashes with it: each short straight piece's slant (second moments) is taken, and the
 * slant most of them share away from level (within 1.5 degrees, at least 12 of them) is the roll. Level pieces are the HUD's parts that do
 * not turn (the altitude scale's ticks, the reticle). Measured on his 0775 / 0777: -10 and -8 against -9.4 and -8.7
 * read once upright; an upright read holds within about a degree either way.
 */
function ladderRoll(rgba: Rgba, w: number, h: number, screen: FrameScreen): number | null {
  const look = PITCH_FINDING_LOOKS[1]!;
  const sh = screen.h;
  const mask = scratchMask("roll", w * h);
  const rx0 = Math.max(0, Math.floor(w / 2 - screen.w * 0.2));
  const rx1 = Math.min(w, Math.ceil(w / 2 + screen.w * 0.2));
  const ry0 = Math.max(0, Math.floor(h / 2 - sh * 0.2));
  const ry1 = Math.min(h, Math.ceil(h / 2 + sh * 0.2));
  for (let y = ry0; y < ry1; y++) mask.fill(0, y * w + rx0, y * w + rx1);
  for (let y = ry0; y < ry1; y++)
    for (let x = rx0; x < rx1; x++) {
      const i = (y * w + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      if (look.isText(r, g, b) && !isStarPx(r, g, b)) mask[y * w + x] = 1;
    }
  const slants: number[] = [];
  for (const c of components(mask, w, rx0, ry0, rx1, ry1)) {
    const len = Math.hypot(c.x1 - c.x0 + 1, c.y1 - c.y0 + 1);
    if (len < sh * 0.006 || len > sh * 0.03) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let y = c.y0; y <= c.y1; y++)
      for (let x = c.x0; x <= c.x1; x++)
        if (mask[y * w + x]) {
          n++;
          sx += x;
          sy += y;
          sxx += x * x;
          syy += y * y;
          sxy += x * y;
        }
    const mx = sx / n;
    const my = sy / n;
    const vx = sxx / n - mx * mx;
    const vy = syy / n - my * my;
    const cxy = sxy / n - mx * my;
    const half = Math.sqrt(((vx - vy) / 2) ** 2 + cxy * cxy);
    const long = (vx + vy) / 2 + half;
    const short = (vx + vy) / 2 - half;
    // Straight and long for its width (a dash: 10 x 3 px, about 11 to 1), not a digit or a star's glow.
    if (short > 0 ? long / short < 5 : long < 4) continue;
    const slant = (0.5 * Math.atan2(2 * cxy, vx - vy) * 180) / Math.PI;
    if (Math.abs(slant) <= 30) slants.push(slant);
  }
  let best: number[] = [];
  for (const t of slants) {
    if (Math.abs(t) < 3) continue;
    const near = slants.filter((u) => Math.abs(u - t) <= 1.5);
    if (near.length > best.length) best = near;
  }
  // Fewer is the reticle's arcs or a ladder half off the frame (upright shots: 7 to 10; rolled ones: 18 to 30).
  if (best.length < 12) return null;
  return best.reduce((s, t) => s + t, 0) / best.length;
}

/**
 * The frame turned by `deg` about its middle (outside the frame black), into a kept buffer: each pixel the nearest
 * one, or blended from the four round it. The blend fills the pixel or two between a box's digits and its outline and
 * can join them (his 1207 "55", turned 3 degrees, read nothing); the nearest pixel breaks a thin stroke instead (0775).
 */
function turnedFrame(rgba: Rgba, w: number, h: number, deg: number, blend: boolean): Uint8Array {
  const out = scratchMask("turned", w * h * 4);
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      out[d + 3] = 255;
      // Each pixel of the upright frame from where it stands in the rolled one.
      const sx = cx + (x - cx) * cos - (y - cy) * sin;
      const sy = cy + (x - cx) * sin + (y - cy) * cos;
      if (!blend) {
        const nx = Math.round(sx);
        const ny = Math.round(sy);
        const inside = nx >= 0 && ny >= 0 && nx < w && ny < h;
        const i = (ny * w + nx) * 4;
        for (let k = 0; k < 3; k++) out[d + k] = inside ? rgba[i + k]! : 0;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) {
        out[d] = out[d + 1] = out[d + 2] = 0;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = (y0 * w + x0) * 4;
      const j = i + w * 4;
      for (let k = 0; k < 3; k++)
        out[d + k] = Math.round((rgba[i + k]! * (1 - fx) + rgba[i + 4 + k]! * fx) * (1 - fy) + (rgba[j + k]! * (1 - fx) + rgba[j + 4 + k]! * fx) * fy);
    }
  return out;
}

/**
 * The pitch in any HUD colour, with the colours it was read in, to keep for the next frames. The game's own yellow and
 * orange first, as they always were read (`glyphs`), unless a recoloured HUD was learned; then `known`, else each colour
 * found on the frame (`discover`: finding them doubles a frame's time, so the capture looks once a second; `hint`: the
 * colours a mod's settings name, EDHM's ini, looked for first), with `anyGlyphs` (hudPitchGlyphsAny.ts): only framed
 * boxes, the ladder in the outline's colour.
 */
function readAnyColourUpright(
  rgba: Rgba,
  w: number,
  h: number,
  glyphs: HudGlyphs,
  anyGlyphs: PitchGlyphs,
  screen: FrameScreen = { w, h },
  known?: PitchColours | null,
  discover = true,
  hint?: PitchColours | null,
): { reading: PitchReading; colours: PitchColours | null } | null {
  /*
    The game's own look first, unless EDHM's ini says the HUD is recoloured (`hint`): a yellow EDHM theme passes for the
    game's yellow, and that path, made for the default look, took the ladder's labels for the boxes (his Domini Inferni
    shots, 1191 "21" read 25: ten wrong of 59). With a hint the recoloured path, outline required, goes first.
  */
  const seen = new Map<HudStyleName, PitchBox[] | null>();
  const defaultLook = (framings?: readonly boolean[]) => {
    const reading = known ? null : readHudPitch(rgba, w, h, glyphs, screen, framings, seen);
    return reading ? { reading, colours: null } : null;
  };
  /*
    A frame without the search (the capture looks for colours once a second): the game's look only, and not at all with
    a hint. With one, the searching frame takes the game's look only when the hinted colours are not on the frame,
    which this frame cannot tell; it read the unframed pair the searching frame had refused, a ladder label (review
    2026-11-10 E2: null, -20, null, -20 on the test scene).
  */
  if (!known && !discover) return hint ? null : defaultLook();
  /*
    Without a hint the game's framed boxes first, its unframed pairs only after the recoloured path: on an orange or
    gold EDHM theme those were the ladder's labels (theme bench, colour-unknown frames: 1203 "79" read 75 on Orokin
    Vision Black, 1226 "-70" read -75 on three themes).
  */
  if (!hint) {
    const found = defaultLook([true]);
    if (found) return found;
  }
  // The hint first; a hinted pair that does not read is followed by the colour-blind search (the theme bench: on light
  // grey themes the hue matched a pair the search would not have chosen, 1,983 against 2,026 of 2,688 read).
  let hintOnScreen = false;
  for (const tryHint of hint && !known ? [hint, null] : [hint ?? null]) {
    const tries = pitchPairsAnyColour(rgba, w, h, screen, known, tryHint);
    hintOnScreen ||= tries.some((t) => t.hinted);
    for (const { colours, look, pair } of tries) {
      const reading = readPair(rgba, w, h, screen, pair, anyGlyphs, look, "learned", lookFromColour(colours.frame).isText, ANY_MIN_MATCH, ANY_MIN_MARGIN);
      if (!reading) continue;
      // A minus in both boxes of the same pair cut the other way, missed in this cut: not sure (his 1009, a rolled box's
      // outline across the digits' bottom rows hid it: -15 read 15). The other way round is a dim minus the other cut
      // missed, and reads right.
      const near = (a: PitchBox, b: PitchBox) => Math.abs(a.x - b.x) < a.dh && Math.abs(a.y - b.y) < a.dh;
      if (reading.boxDeg >= 0 && tries.some((t) => near(t.pair.left, pair.left) && t.pair.left.minus && t.pair.right.minus)) return null;
      return { reading, colours };
    }
  }
  /*
    The game's own look last: its unframed pairs without a hint; with one, only when the hinted colours are not on the
    frame (a stale hint). Boxes in the hinted colours that did not read are not the game's look: on orange themes its
    orange table read them (theme bench, 1198 "66" read 68 on Coach Purple and Orange).
  */
  if (hintOnScreen) return null;
  return defaultLook(hint ? [true, false] : [false]);
}

/**
 * The framed pairs a recoloured HUD's pitch could be read from, in the order they are tried: `known`'s colours, else
 * each found on the frame; in the learned colour, else as found colour-blind (a star beside a white box joins its string
 * in the colour). The glyph builder cuts its samples from them (scripts/build-hud-pitch-glyphs-any.ts).
 */
export function pitchPairsAnyColour(
  rgba: Rgba,
  w: number,
  h: number,
  screen: FrameScreen = { w, h },
  known?: PitchColours | null,
  hint?: PitchColours | null,
): { colours: PitchColours; look: TextLook; pair: Pair; hinted: boolean }[] {
  const out: { colours: PitchColours; look: TextLook; pair: Pair; hinted: boolean }[] = [];
  for (const { colours, pair: seen, hinted } of known ? [{ colours: known, pair: null, hinted: false }] : discoverPitchPairs(rgba, w, h, screen, hint)) {
    const look = lookFromColour(colours.text);
    const inColour = findPitchBoxes(rgba, w, h, screen, look, true) ?? (seen ? nearPair(rgba, w, h, screen, look, seen) : null);
    if (inColour) out.push({ colours, look, pair: inColour, hinted });
    if (seen) out.push({ colours, look, pair: { left: minusIn(rgba, w, seen.left, look), right: minusIn(rgba, w, seen.right, look) }, hinted });
  }
  return out;
}

/**
 * The pair found colour-blind, cut again in its learned colour round where it stands: a dim grey theme over grey
 * ground marks more of the middle than MAX_TEXT_SHARE (his 0973: 23 %, the search gives up), while the colour-blind
 * cut broke its digits (a 2 in pieces, dropped: "82" read as 8). The band is the pair's rows and a few digits either
 * side, small enough to cut however full; framed and paired as ever.
 */
function nearPair(rgba: Rgba, w: number, h: number, screen: FrameScreen, look: TextLook, seen: Pair): Pair | null {
  const { left, right } = seen;
  const dh = Math.max(left.dh, right.dh);
  const band: Rect = {
    x0: Math.floor(Math.min(left.x, right.x) - dh * 4),
    y0: Math.floor(Math.min(left.y, right.y) - dh * 2),
    x1: Math.ceil(Math.max(left.x, right.x) + dh * 4),
    y1: Math.ceil(Math.max(left.y, right.y) + dh * 2),
  };
  const found = lookBoxes(rgba, w, h, screen, look, band);
  return found && pitchPair(framedOnly(rgba, w, h, found), w, h, screen);
}

/** The heading, read off the HUD's tape (hudPitchReader's sibling; owner 2026-11-04: on-screen data, live). */
export interface HeadingReading {
  /** Degrees 0-360, the fraction from the tape's 10-degree ticks when found (else the box's whole degrees + 0.5). */
  headingDeg: number;
  /** The box's whole number as shown (the game drops the fraction, as for the pitch). */
  boxDeg: number;
  /** Screen pixels per degree along the tape; null when fewer than two long ticks were found. */
  pxPerDeg: number | null;
}

const isTickPx = (r: number, g: number, b: number) => r > 170 && g > 60 && g < 210 && b < 100 && r - b > 110;

/**
 * The heading from the tape at the top of the HUD: a box with the heading's whole degrees over a row of ticks, a long
 * one every 10 degrees and a short one every 2 (on the owner's screen 22.5 px per degree). The whole HUD turns with the
 * ship's roll, the box with it, so the index is the box's own centre (his 47-degree shot banked 5 degrees: the point
 * straight above the screen's centre read 48.4, the box's centre 47.2). Each long tick's value is the multiple of 10
 * that puts the index within 1.5 degrees of the box's number. Good to about a degree (his shots disagree by that
 * between the box and the tape), but live.
 *
 * `frame` is a crop (`ox`, `oy` its place on a `screen`). Null when the box cannot be read.
 */
export function readHudHeading(rgba: Rgba, w: number, h: number, glyphs: HudGlyphs, at: { ox: number; oy: number; screen: FrameScreen }): HeadingReading | null {
  for (const styleName of ["yellow", "orange"] as const) {
    const g = glyphs[styleName];
    const r = g ? readHeadingIn(rgba, w, h, g, at, styleName) : null;
    if (r) return r;
  }
  return null;
}

/**
 * A white blob within a character of the box's figures, on either side: a star over a figure (the HUD is drawn
 * additively, yellow over white is white), whose loss leaves a valid number: 180 read 80 (review 2026-11-10 E6). The
 * yellow and orange text this reads is never near white. 15 % of a character's square: a star of the test's
 * size covers 18 %, the sky's own stars a few pixels.
 */
function whiteBeside(rgba: Rgba, w: number, run: readonly Rect[], top: number, bottom: number, cell: number): boolean {
  const x0 = Math.min(...run.map((c) => c.x0));
  const x1 = Math.max(...run.map((c) => c.x1));
  const h = rgba.length / 4 / w;
  const count = (from: number, to: number) => {
    let n = 0;
    for (let y = Math.max(0, top); y <= Math.min(h - 1, bottom); y++)
      for (let x = Math.max(0, from); x <= Math.min(w - 1, to); x++) {
        const i = (y * w + x) * 4;
        if (Math.min(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) >= 200) n++;
      }
    return n;
  };
  const enough = cell * (bottom - top + 1) * 0.15;
  return count(x0 - cell, x0 - 1) >= enough || count(x1 + 1, x1 + cell) >= enough;
}

function readHeadingIn(
  rgba: Rgba,
  w: number,
  h: number,
  glyphs: Readonly<Record<string, readonly (readonly number[])[]>>,
  at: { ox: number; oy: number; screen: FrameScreen },
  styleName: HudStyleName,
): HeadingReading | null {
  const style = STYLES[styleName];
  const { ox, oy, screen } = at;
  const sh = screen.h;
  // The box's digits: the brightest yellow, in the band the tape's box stands in (a quarter of the way down).
  const mask = scratchMask("heading", w * h);
  const by0 = Math.max(0, Math.round(sh * 0.22) - oy);
  const by1 = Math.min(h, Math.round(sh * 0.32) - oy);
  const bx0 = Math.max(0, Math.round(screen.w * 0.44) - ox);
  const bx1 = Math.min(w, Math.round(screen.w * 0.56) - ox);
  for (let y = by0; y < by1; y++) mask.fill(0, y * w + bx0, y * w + bx1);
  for (let y = by0; y < by1; y++)
    for (let x = bx0; x < bx1; x++) {
      const i = y * w + x;
      if (style.isText(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)) mask[i] = 1;
    }
  const minH = Math.max(5, sh * 0.007);
  const pieces = components(mask, w, bx0, by0, bx1, by1).filter((c) => {
    const ch = c.y1 - c.y0 + 1;
    return ch >= minH && ch <= sh * 0.03 && c.x1 - c.x0 + 1 >= ch * 0.2;
  });
  if (!pieces.length) return null;
  // The string nearest the screen's centre line, its pieces on one row.
  const cx = screen.w / 2 - ox;
  pieces.sort((a, b) => Math.abs((a.x0 + a.x1) / 2 - cx) - Math.abs((b.x0 + b.x1) / 2 - cx));
  const seed = pieces[0]!;
  const sy = (seed.y0 + seed.y1) / 2;
  const sh0 = seed.y1 - seed.y0 + 1;
  const row = pieces.filter((c) => Math.abs((c.y0 + c.y1) / 2 - sy) < sh0 * 0.4).sort((a, b) => a.x0 - b.x0);
  // Only the run of pieces around the seed, close together.
  const run: Rect[] = [seed];
  for (const c of row.filter((c) => c.x0 > seed.x0)) if (c.x0 - run[run.length - 1]!.x1 < sh0 * 0.9) run.push(c);
  for (const c of row.filter((c) => c.x1 < seed.x0).reverse()) if (run[0]!.x0 - c.x1 < sh0 * 0.9) run.unshift(c);
  if (run.length > 3) return null;
  const top = Math.min(...run.map((c) => c.y0));
  const bottom = Math.max(...run.map((c) => c.y1));
  let text = "";
  for (const c of run) {
    const d = matchDigit(glyphVector(rgba, w, { ...c, y0: top, y1: bottom }, GLYPH_W, GLYPH_H, style.ink), glyphs);
    if (d == null) return null;
    text += String(d);
  }
  const boxDeg = Number(text);
  if (!(boxDeg >= 0 && boxDeg < 360)) return null;
  const dh = bottom - top + 1;
  if (whiteBeside(rgba, w, run, top, bottom, dh)) return null;

  // The ticks: orange columns just under the box.
  const ty0 = Math.min(h, bottom + Math.round(dh * 0.3));
  const ty1 = Math.min(h, bottom + Math.round(dh * 6));
  const cols: { x: number; n: number; y: number }[] = [];
  for (let x = Math.max(0, Math.round(cx - sh * 0.17)); x < Math.min(w, Math.round(cx + sh * 0.17)); x++) {
    let n = 0;
    let ys = 0;
    for (let y = ty0; y < ty1; y++) {
      const i = (y * w + x) * 4;
      if (isTickPx(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)) {
        n++;
        ys += y;
      }
    }
    if (n >= Math.max(4, dh * 0.3)) cols.push({ x, n, y: ys / n });
  }
  const ticks: { x: number; n: number; y: number }[] = [];
  let g: typeof cols = [];
  const flush = () => {
    if (g.length) ticks.push({ x: g.reduce((t, c) => t + c.x, 0) / g.length, n: Math.max(...g.map((c) => c.n)), y: g.reduce((t, c) => t + c.y, 0) / g.length });
    g = [];
  };
  for (const c of cols) {
    if (g.length && c.x - g[g.length - 1]!.x > 1) flush();
    g.push(c);
  }
  flush();
  const mid = (boxDeg + 0.5) % 360;
  if (ticks.length < 3) return { headingDeg: mid, boxDeg, pxPerDeg: null };
  const minor = [...ticks].sort((a, b) => a.n - b.n)[Math.floor(ticks.length / 3)]!.n;
  const longs = ticks.filter((t) => t.n >= minor * 1.7);
  if (longs.length < 2) return { headingDeg: mid, boxDeg, pxPerDeg: null };
  const pxPerDeg = (longs[1]!.x - longs[0]!.x) / 10;
  if (!(pxPerDeg > dh * 0.5)) return { headingDeg: mid, boxDeg, pxPerDeg: null };
  // The index: the box's own centre (the box turns with the HUD, so the roll needs no sum of its own).
  const indexX = (Math.min(...run.map((c) => c.x0)) + Math.max(...run.map((c) => c.x1))) / 2;
  const fits = longs.map((t) => {
    const off = (indexX - t.x) / pxPerDeg;
    let hdg = Math.round((boxDeg - off) / 10) * 10 + off;
    if (hdg < boxDeg - 180) hdg += 360;
    if (hdg > boxDeg + 180) hdg -= 360;
    return hdg;
  });
  const near = fits.filter((f) => Math.abs(f - boxDeg - 0.5) <= 1.5);
  if (!near.length) return { headingDeg: mid, boxDeg, pxPerDeg };
  const mean = near.reduce((t, f) => t + f, 0) / near.length;
  return { headingDeg: Math.round(((mean % 360) + 360) % 360 * 10) / 10, boxDeg, pxPerDeg };
}

