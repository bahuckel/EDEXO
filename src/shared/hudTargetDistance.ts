/**
 * The distance to the target, read off the game's HUD (plan 1.3.8, Scan route travelling arrow; owner's F10 shots
 * 2026-11-05). Status.json names the body targeted but not how far it is; the HUD writes it under the target's name,
 * beside its bracket: "1,957Ls", "89.2Ls", "0.93Ls", "13.1Mm", with the time to get there on the line under it
 * ("0:27", "1.2 d", "> 1 year"). This finds that line in a frame of the game and reads it:
 *
 * - the text is the HUD's orange, its cores near yellow (about 240, 200, 0); stars on it are joined in as in the pitch
 *   reader (hudPitchReader.ts), whose glyph matching this uses: each character against samples cut from the owner's
 *   own screenshots (hudDistanceGlyphs.ts);
 * - a distance is digits then a unit, "Ls", "Mm" or "km" (a capital then a small letter); other bodies' labels carry
 *   one too (the planet's parent beside it), so the target's is the one with the time line under it;
 * - the separator is never read as a comma or a point: the game writes three figures under 1,000 ("8.59", "89.2",
 *   "927") and whole numbers with a thousands comma above ("1,957"), so where it sits says which it is, and a line
 *   that breaks those rules is not read.
 *
 * Pure (a frame in, a reading out), tested on the owner's screenshots; the capture is the screen marker's (aim/).
 * Null when it cannot be sure.
 */
import { components, glyphVector, matchGlyph, GLYPH_H, GLYPH_W } from "./hudPitchReader.js";

type Rgba = Uint8Array | Uint8ClampedArray;
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A light-second in megametres and in kilometres. */
const LS_MM = 299.792458;
const LS_KM = 299_792.458;

export type DistanceUnit = "Ls" | "Mm" | "km";

export interface TargetDistance {
  /** The distance in light-seconds. */
  distLs: number;
  /** As the HUD wrote it ("1,957Ls"). */
  text: string;
  unit: DistanceUnit;
  /** The line's left end and baseline, in the frame's pixels. */
  x: number;
  y: number;
}

/** Glyph samples: tall characters (digits and the unit's capital) and small ones (the unit's second letter). */
export interface DistanceGlyphs {
  tall: Readonly<Record<string, readonly (readonly number[])[]>>;
  small: Readonly<Record<string, readonly (readonly number[])[]>>;
}

/** The text's cores: orange to yellow, no blue (a star's white has it, the grid's blue and the nebulae are too dark). */
const isTextPx = (r: number, g: number, b: number) => r >= 205 && g >= 120 && b <= 60 && r - b >= 165;
const isStarPx = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200;
/**
 * How much of the text's core a pixel holds, for the glyph images: its yellow (the smaller of red and green over blue),
 * so the orange glow round the strokes counts for little. With the red alone the glow filled the gaps and 5, 6, 8, 9
 * and the HUD's slashed 0 looked alike (his 330 read 338).
 */
export const distanceInk = (r: number, g: number, b: number) => Math.max(0, Math.min(1, (Math.min(r, g) - b - 60) / 150));

/** One line of text as found: its pieces left to right, its baseline and its capitals' height. */
export interface TextLine {
  pieces: Rect[];
  x0: number;
  x1: number;
  top: number;
  base: number;
  /** The tallest piece's height (a digit's), pixels. */
  dh: number;
}

/** The part of the screen searched (shares of it): the bracket can be anywhere ahead, not under the cockpit's panels. */
const AREA = { x0: 0.08, x1: 0.92, y0: 0.04, y1: 0.72 };

/** Lines of the HUD's text in a frame: pieces about a character high, on one baseline, close together. */
export function findTextLines(rgba: Rgba, w: number, h: number, screenH = h): TextLine[] {
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = rgba[p]!;
    const g = rgba[p + 1]!;
    const b = rgba[p + 2]!;
    if (isTextPx(r, g, b) || isStarPx(r, g, b)) mask[i] = 1;
  }
  // On the owner's 1440-row screen a digit is 15 px, a small letter 10.
  const minH = Math.max(5, screenH * 0.0055);
  const maxH = screenH * 0.017;
  const pieces = components(mask, w, 0, 0, w, h).filter((c) => {
    const ch = c.y1 - c.y0 + 1;
    const cw = c.x1 - c.x0 + 1;
    // Not a comma (short and narrow, hanging under the line): it would break the baseline the figures share.
    const comma = ch <= screenH * 0.0085 && cw <= ch * 0.75;
    return ch >= minH && ch <= maxH && cw <= ch * 1.6 && cw >= 2 && !comma;
  });
  pieces.sort((a, b) => a.x0 - b.x0);
  const groups: Rect[][] = [];
  for (const c of pieces) {
    const g = groups.find((l) => {
      const last = l[l.length - 1]!;
      const dh = Math.max(...l.map((p) => p.y1 - p.y0 + 1));
      // The labels slant with where they stand on the screen (his 0.50Ls: 5 px over the line): the baseline may drift.
      const gap = c.x0 - last.x1;
      return Math.abs(c.y1 - last.y1) <= Math.max(2, dh * 0.15) + 0.15 * Math.max(0, gap) && gap >= 0 && gap <= dh * 1.25;
    });
    if (g) g.push(c);
    else groups.push([c]);
  }
  return groups
    .filter((l) => l.length >= 2)
    .map((l) => {
      const base = Math.round(l.map((p) => p.y1).sort((a, b) => a - b)[Math.floor(l.length / 2)]!);
      const dh = Math.max(...l.map((p) => p.y1 - p.y0 + 1));
      return { pieces: l, x0: Math.min(...l.map((p) => p.x0)), x1: Math.max(...l.map((p) => p.x1)), top: base - dh + 1, base, dh };
    });
}

/**
 * Where the comma or point stands, after how many figures: the HUD's font is monospaced, its comma and point a whole
 * character wide, so a figure two characters on from the last has one between them. The character's width is the
 * nearest two tall pieces' spacing (the last figure and the unit's capital always touch cells). Measured, not looked
 * for: the point can merge into a figure's glow or sit on a star.
 */
function separators(pieces: readonly Rect[]): number[] {
  const mid = pieces.map((c) => (c.x0 + c.x1) / 2);
  const steps = mid.slice(1).map((m, i) => m - mid[i]!);
  const cell = Math.min(...steps);
  const out: number[] = [];
  // The figures only: the unit's capital follows the last one directly.
  for (let i = 0; i < steps.length - 1; i++) if (steps[i]! > cell * 1.5) out.push(i + 1);
  return out;
}

/**
 * The number from its digits and where separators stood (after how many digits), by the game's own rules; null when
 * they break them.
 */
export function numberFrom(digits: string, seps: readonly number[]): number | null {
  const n = digits.length;
  if (!n || !/^\d+$/.test(digits)) return null;
  if (!seps.length) return n <= 3 && (n === 1 || digits[0] !== "0") ? Number(digits) : null;
  // Three figures with a point ("8.59", "89.2", "0.93").
  if (n === 3 && seps.length === 1 && seps[0]! >= 1 && seps[0]! <= 2) {
    const k = seps[0]!;
    if (k === 2 && digits[0] === "0") return null;
    return Number(`${digits.slice(0, k)}.${digits.slice(k)}`);
  }
  // A whole number with thousands commas ("1,957", "12,345").
  if (n < 4 || digits[0] === "0") return null;
  const want: number[] = [];
  for (let k = n - 3; k > 0; k -= 3) want.unshift(k);
  return want.length === seps.length && want.every((k, i) => seps[i] === k) ? Number(digits) : null;
}

/**
 * A line cut the way a distance is written: figures, then a capital and a small letter; each as its glyph image (the
 * small letter from the small letters' height, so "s" and "m" keep their shape). Null when the line is not of that
 * shape. The glyph builder cuts its samples with this.
 */
export function cutDistanceLine(rgba: Rgba, w: number, line: TextLine): { figures: number[][]; cap: number[]; small: number[] } | null {
  const p = line.pieces;
  if (p.length < 3 || p.length > 9) return null;
  const isTall = (c: Rect) => c.y1 - c.y0 + 1 >= line.dh * 0.82;
  const cap = p[p.length - 2]!;
  const small = p[p.length - 1]!;
  if (!isTall(cap) || isTall(small)) return null;
  const nums = p.slice(0, -2);
  if (!nums.every(isTall)) return null;
  const vec = (c: Rect) => glyphVector(rgba, w, c, GLYPH_W, GLYPH_H, distanceInk);
  return {
    figures: nums.map(vec),
    cap: vec(cap),
    small: vec({ ...small, y0: Math.min(small.y0, line.base - Math.round(line.dh * 0.68)) }),
  };
}

/** A line read as a distance: digits, then a capital and a small letter (Ls, Mm, km); null when it is not one. */
export function readDistanceLine(rgba: Rgba, w: number, line: TextLine, glyphs: DistanceGlyphs): TargetDistance | null {
  const cut = cutDistanceLine(rgba, w, line);
  if (!cut) return null;
  const unit = `${matchGlyph(cut.cap, glyphs.tall) ?? "?"}${matchGlyph(cut.small, glyphs.small) ?? "?"}`;
  if (unit !== "Ls" && unit !== "Mm" && unit !== "km") return null;
  let digits = "";
  for (const f of cut.figures) {
    const d = matchGlyph(f, glyphs.tall);
    if (d == null || !/^\d$/.test(d)) return null;
    digits += d;
  }
  const seps = separators(line.pieces.slice(0, -1));
  const value = numberFrom(digits, seps);
  if (value == null) return null;
  let text = digits;
  for (const k of [...seps].reverse()) text = `${text.slice(0, k)}${seps.length === 1 && digits.length === 3 ? "." : ","}${text.slice(k)}`;
  const distLs = unit === "Ls" ? value : unit === "Mm" ? value / LS_MM : value / LS_KM;
  return { distLs, text: `${text}${unit}`, unit, x: line.x0, y: line.base };
}

/** A line under `line`, starting where it starts: the target's time to arrive. */
export function lineUnder(lines: readonly TextLine[], line: TextLine): boolean {
  return lines.some((o) => o !== line && o.top > line.base && o.top - line.base <= line.dh * 1.3 && Math.abs(o.x0 - line.x0) <= line.dh * 1.2);
}

/**
 * The target's distance in a frame (or a crop of one: `screenH` is the whole screen's height, the text's size is
 * measured in it); null when no line reads as one, or more than one target line does.
 */
export function readTargetDistance(rgba: Rgba, w: number, h: number, glyphs: DistanceGlyphs, screenH = h): TargetDistance | null {
  const lines = findTextLines(rgba, w, h, screenH);
  const found: TargetDistance[] = [];
  for (const l of lines) {
    if (!lineUnder(lines, l)) continue;
    const r = readDistanceLine(rgba, w, l, glyphs);
    if (r) found.push(r);
  }
  return found.length === 1 ? found[0]! : null;
}

/** The part of a screen the reader looks in, in pixels of a `w` x `h` screen. */
export function distanceArea(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const x = Math.round(w * AREA.x0);
  const y = Math.round(h * AREA.y0);
  return { x, y, w: Math.round(w * AREA.x1) - x, h: Math.round(h * AREA.y1) - y };
}
