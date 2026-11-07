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

/** Connected pieces of a mask (4-neighbour), in a region. */
export function components(mask: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number): Rect[] {
  const seen = new Uint8Array(mask.length);
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
        for (const k of [j - 1, j + 1, j - w, j + w]) {
          const kx = k % w;
          const ky = (k - kx) / w;
          if (kx < x0 || kx >= x1 || ky < y0 || ky >= y1 || !mask[k] || seen[k]) continue;
          seen[k] = 1;
          stack.push(k);
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
  // The nearest sample of each digit (the samples differ with the background; an average blurs 0, 6 and 8 together:
  // 116 of 132 held-out digits right against 109, 2026-11-04).
  let best: string | null = null;
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
      bestScore = dot;
      best = d;
    } else if (dot > second) second = dot;
  }
  if (best == null || bestScore < minMatch || bestScore - second < minMargin) return null;
  return best;
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
function hasMinus(rgba: Rgba, w: number, left: number, top: number, bottom: number, ink = yellowness): boolean {
  const dh = bottom - top + 1;
  const mid = (top + bottom) / 2;
  const x0 = Math.round(left - dh * 0.85);
  const x1 = Math.round(left - dh * 0.1);
  let bar = 0;
  let cols = 0;
  for (let x = x0; x <= x1; x++) {
    cols++;
    let midY = 0;
    for (let y = Math.round(mid - dh * 0.22); y <= Math.round(mid + dh * 0.22); y++) {
      const i = (y * w + x) * 4;
      midY = Math.max(midY, ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
    }
    let edge = 0;
    for (const y of [top, top + 1, bottom - 1, bottom]) {
      const i = (y * w + x) * 4;
      edge = Math.max(edge, ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
    }
    // Against the bar's own ink, not a fixed edge: bright sand behind a gear-down box inks 0.33-0.44 everywhere
    // (2026-11-06, Screenshot_0325: -19 read as 19).
    if (midY > 0.45 && midY - edge > 0.3) bar++;
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
    const up = i - 3 * w * 4;
    const dn = i + 3 * w * 4;
    let c = 0;
    for (let k = 0; k < 3; k++) c = Math.max(c, rgba[i + k]! - Math.max(rgba[up + k]!, rgba[dn + k]!));
    return c;
  };
  const MIN = 18;
  type Pt = { x0: number; y0: number; x1: number; y1: number };
  const trace = (ya: number, yb: number): Pt[] | null => {
    let y0 = -1;
    let best = MIN - 1;
    for (let y = ya; y <= yb; y++) {
      const c = line(cx, y);
      if (c > best) {
        best = c;
        y0 = y;
      }
    }
    if (y0 < 0) return null;
    let x0 = cx;
    let x1 = cx;
    const pts: Pt[] = [{ x0: cx, y0, x1: cx, y1: y0 }];
    for (const dir of [-1, 1]) {
      let y = y0;
      let gap = 0;
      for (let x = cx + dir; x >= 0 && x < w && gap <= 3; x += dir) {
        let by = y;
        let bc = MIN - 1;
        for (const yy of [y, y - 1, y + 1]) {
          const c = line(x, yy);
          if (c > bc) {
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
  // Clear of the digits' own soft edge.
  const above = trace(Math.round(top - dh), Math.round(top - dh * 0.2));
  const below = above && trace(Math.round(bottom + dh * 0.2), Math.round(bottom + dh));
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
  const thirds = (x: number): [number, number, number] => {
    const most: [number, number, number] = [0, 0, 0];
    for (let y = top; y <= bottom; y++) {
      const i = (y * w + x) * 4;
      const k = y < top + third ? 0 : y > bottom - third ? 2 : 1;
      most[k] = Math.max(most[k], ink(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
    }
    return most;
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
  const style = lookOf(look);
  const sw = screen.w;
  const sh = screen.h;
  const mask = new Uint8Array(w * h);
  // The middle 40 % of the screen, either way (or all of a crop that is no bigger).
  const rx0 = Math.max(0, Math.floor(w / 2 - sw * 0.2));
  const rx1 = Math.min(w, Math.ceil(w / 2 + sw * 0.2));
  const ry0 = Math.max(0, Math.floor(h / 2 - sh * 0.2));
  const ry1 = Math.min(h, Math.ceil(h / 2 + sh * 0.2));
  let marked = 0;
  for (let y = ry0; y < ry1; y++)
    for (let x = rx0; x < rx1; x++) {
      const i = y * w + x;
      if (style.isText(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!) || isStarPx(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)) {
        mask[i] = 1;
        marked++;
      }
    }
  if (marked > (rx1 - rx0) * (ry1 - ry0) * MAX_TEXT_SHARE) return null;
  const minH = Math.max(5, sh * 0.007);
  const maxH = sh * 0.03;
  const raw = components(mask, w, rx0, ry0, rx1, ry1);
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
    // The box's arrow strokes sit on the digits' row but are shorter than them.
    const tallest = Math.max(...all.map((c) => c.y1 - c.y0 + 1));
    const g = all.filter((c) => c.y1 - c.y0 + 1 >= tallest * 0.75);
    const top = Math.min(...g.map((c) => c.y0));
    const bottom = Math.max(...g.map((c) => c.y1));
    const left = Math.min(...g.map((c) => c.x0));
    const right = Math.max(...g.map((c) => c.x1));
    const dh = bottom - top + 1;
    const digits = g.flatMap((p) => splitWide(mask, w, { ...p, y0: top, y1: bottom }, dh));
    const box: PitchBox = { digits, minus: hasMinus(rgba, w, left, top, bottom, style.ink), x: (left + right) / 2, y: (top + bottom) / 2, dh, frame: null };
    return framed && digits.length ? { ...box, frame: framedBy(rgba, w, h, box) } : box;
  });
  const boxes = framed ? found.filter((b) => b.frame) : found;
  // The pair: mirrored about the centre (the boxes stand either side of the nose), the same size.
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
    const d = matchGlyph(glyphVector(rgba, w, c, GLYPH_W, GLYPH_H, ink), glyphs, minMatch, minMargin);
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
export function readHudPitch(rgba: Rgba, w: number, h: number, glyphs: HudGlyphs, screen: FrameScreen = { w, h }): PitchReading | null {
  for (const styleName of ["yellow", "orange"] as const) {
    const g = glyphs[styleName];
    if (!g) continue;
    // The boxes with their outline first: the ladder's "0" labels are a mirrored pair too, nearer the centre than the
    // boxes when the nose is just under the horizon (his 0010, "-1" read 0); the plain nearest pair stays the fallback.
    for (const framed of [true, false]) {
      const pair = findPitchBoxes(rgba, w, h, screen, styleName, framed);
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
): { colours: PitchColours; pair: Pair }[] {
  const out: { colours: PitchColours; pair: Pair }[] = [];
  const hinted = hint ? findPitchBoxes(rgba, w, h, screen, hueLook(hint.text), true) : null;
  if (hinted) {
    const text = strokeColour(rgba, w, [...hinted.left.digits, ...hinted.right.digits]);
    out.push({ colours: { text, frame: hinted.left.frame! }, pair: hinted });
    return out;
  }
  for (const finding of PITCH_FINDING_LOOKS) {
    const pair = findPitchBoxes(rgba, w, h, screen, finding, true);
    if (!pair) continue;
    const text = strokeColour(rgba, w, [...pair.left.digits, ...pair.right.digits]);
    if (!out.some((o) => sameColour(o.colours.text, text))) out.push({ colours: { text, frame: pair.left.frame! }, pair });
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
  return { ...b, minus: hasMinus(rgba, w, Math.min(...b.digits.map((c) => c.x0)), top, bottom, look.ink) };
}

/**
 * The any-colour table's least match (as the distance reader's: a lower one let a wrong digit through), and how far ahead
 * of the next digit: his cyan theme's slashed 0 read as 8 at 0.04 (a 40 read 48, held out); 0.05 and up none wrong,
 * 0.06 for room (165 right, 158 not sure, 0 wrong of 323 held out, 2026-11-07).
 */
const ANY_MIN_MATCH = 0.85;
const ANY_MIN_MARGIN = 0.06;

/**
 * The pitch in any HUD colour, with the colours it was read in, to keep for the next frames. The game's own yellow and
 * orange first, as they always were read (`glyphs`), unless a recoloured HUD was learned; then `known`, else each colour
 * found on the frame (`discover`: finding them doubles a frame's time, so the capture looks once a second; `hint`: the
 * colours a mod's settings name, EDHM's ini, looked for first), with `anyGlyphs` (hudPitchGlyphsAny.ts): only framed
 * boxes, the ladder in the outline's colour.
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
  /*
    The game's own look first, unless EDHM's ini says the HUD is recoloured (`hint`): a yellow EDHM theme passes for the
    game's yellow, and that path, made for the default look, took the ladder's labels for the boxes (his Domini Inferni
    shots, 1191 "21" read 25: ten wrong of 59). With a hint the recoloured path, outline required, goes first.
  */
  const defaultLook = () => {
    const reading = known ? null : readHudPitch(rgba, w, h, glyphs, screen);
    return reading ? { reading, colours: null } : null;
  };
  // A frame without the search (the capture looks for colours once a second): the game's look only.
  if (!known && !discover) return defaultLook();
  if (!hint) {
    const found = defaultLook();
    if (found) return found;
  }
  // The hint first; a hinted pair that does not read is followed by the colour-blind search (the theme bench: on light
  // grey themes the hue matched a pair the search would not have chosen, 1,983 against 2,026 of 2,688 read).
  for (const tryHint of hint && !known ? [hint, null] : [hint ?? null])
    for (const { colours, look, pair } of pitchPairsAnyColour(rgba, w, h, screen, known, tryHint)) {
      const reading = readPair(rgba, w, h, screen, pair, anyGlyphs, look, "learned", lookFromColour(colours.frame).isText, ANY_MIN_MATCH, ANY_MIN_MARGIN);
      if (reading) return { reading, colours };
    }
  return hint ? defaultLook() : null;
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
): { colours: PitchColours; look: TextLook; pair: Pair }[] {
  const out: { colours: PitchColours; look: TextLook; pair: Pair }[] = [];
  for (const { colours, pair: seen } of known ? [{ colours: known, pair: null }] : discoverPitchPairs(rgba, w, h, screen, hint)) {
    const look = lookFromColour(colours.text);
    const inColour = findPitchBoxes(rgba, w, h, screen, look, true);
    if (inColour) out.push({ colours, look, pair: inColour });
    if (seen) out.push({ colours, look, pair: { left: minusIn(rgba, w, seen.left, look), right: minusIn(rgba, w, seen.right, look) } });
  }
  return out;
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
  const mask = new Uint8Array(w * h);
  const by0 = Math.max(0, Math.round(sh * 0.22) - oy);
  const by1 = Math.min(h, Math.round(sh * 0.32) - oy);
  const bx0 = Math.max(0, Math.round(screen.w * 0.44) - ox);
  const bx1 = Math.min(w, Math.round(screen.w * 0.56) - ox);
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
