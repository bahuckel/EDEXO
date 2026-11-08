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
import { findingLook, hueLook, lookFromColour, MAX_TEXT_SHARE, sameColour, strokeColour, type Rgb, type TextLook } from "./hudTextLook.js";

export { lookFromColour, type Rgb, type TextLook };

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

/** The game's default orange. */
export const ORANGE_LOOK: TextLook = { isText: isTextPx, ink: distanceInk };

/*
  Strict, then soft: most themes' text stands clear at 170, and lower its glow joins the digits to each other and to
  the stars; EDHM's softer themes (his light blue) have most of their strokes between 120 and 170, found only at 130.
*/
const FINDING_LOOKS: readonly TextLook[] = [findingLook(170, 90), findingLook(130, 70)];

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

/**
 * A piece too wide for one character split at its thinnest column (fewest text pixels in its middle half), again
 * until each part is one character wide or less. EDHM's bolder fonts join neighbours: his white theme's "0.87Ls" had
 * the 7 and the L as one piece (2026-11-06), 1.8 of its height wide; one character with its glow is up to about one
 * height wide (cut at 0.95, single orange figures split: 98 of 218 read).
 */
function splitJoined(mask: Uint8Array, w: number, c: Rect): Rect[] {
  const ch = c.y1 - c.y0 + 1;
  const cw = c.x1 - c.x0 + 1;
  if (cw <= ch * 1.3 || cw > ch * 3.5) return [c];
  const from = c.x0 + Math.floor(cw / 4);
  const to = c.x1 - Math.floor(cw / 4);
  // The thinnest column; of equally thin ones the nearest the middle, where two characters of one width meet.
  const mid = (c.x0 + c.x1) / 2;
  let best = -1;
  let bestN = Infinity;
  for (let x = from; x <= to; x++) {
    let n = 0;
    for (let y = c.y0; y <= c.y1; y++) n += mask[y * w + x]!;
    if (n < bestN || (n === bestN && Math.abs(x - mid) < Math.abs(best - mid))) {
      bestN = n;
      best = x;
    }
  }
  if (best < 0) return [c];
  const shrink = (x0: number, x1: number): Rect | null => {
    let y0 = Infinity;
    let y1 = -1;
    for (let y = c.y0; y <= c.y1; y++)
      for (let x = x0; x <= x1; x++)
        if (mask[y * w + x]) {
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    return y1 >= 0 ? { x0, y0, x1, y1 } : null;
  };
  return [shrink(c.x0, best - 1), shrink(best + 1, c.x1)].filter((r): r is Rect => !!r).flatMap((r) => splitJoined(mask, w, r));
}

/** Lines of the HUD's text in a frame: pieces about a character high, on one baseline, close together. */
export function findTextLines(rgba: Rgba, w: number, h: number, screenH = h, look: TextLook = ORANGE_LOOK): TextLine[] {
  const mask = new Uint8Array(w * h);
  let marked = 0;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = rgba[p]!;
    const g = rgba[p + 1]!;
    const b = rgba[p + 2]!;
    if (look.isText(r, g, b) || isStarPx(r, g, b)) {
      mask[i] = 1;
      marked++;
    }
  }
  if (marked > w * h * MAX_TEXT_SHARE) return [];
  // On the owner's 1440-row screen a digit is 15 px, a small letter 10.
  const minH = Math.max(5, screenH * 0.0055);
  const maxH = screenH * 0.017;
  const pieces = components(mask, w, 0, 0, w, h)
    .flatMap((c) => splitJoined(mask, w, c))
    .filter((c) => {
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
export function cutDistanceLine(
  rgba: Rgba,
  w: number,
  line: TextLine,
  look: TextLook = ORANGE_LOOK,
): { figures: number[][]; cap: number[]; small: number[] } | null {
  const p = line.pieces;
  if (p.length < 3 || p.length > 9) return null;
  const isTall = (c: Rect) => c.y1 - c.y0 + 1 >= line.dh * 0.82;
  const cap = p[p.length - 2]!;
  const small = p[p.length - 1]!;
  if (!isTall(cap) || isTall(small)) return null;
  const nums = p.slice(0, -2);
  if (!nums.every(isTall)) return null;
  const vec = (c: Rect) => glyphVector(rgba, w, c, GLYPH_W, GLYPH_H, look.ink);
  return {
    figures: nums.map(vec),
    cap: vec(cap),
    small: vec({ ...small, y0: Math.min(small.y0, line.base - Math.round(line.dh * 0.68)) }),
  };
}

/**
 * The least a character's best glyph must score to be read: above the pitch reader's 0.75. On his EDHM shots a white
 * 8 beside a star and a planet's edge scored 0.81 as a 6 (18.6 Mm read 16.6, 2026-11-06). Swept on 388 labelled shots:
 * 0.75 and 0.8 kept that wrong read, 0.85 none (default 201 of 218, EDHM 152 of 170 read), 0.9 none and 35 fewer.
 */
const DISTANCE_MIN_MATCH = 0.85;

/** A line read as a distance: digits, then a capital and a small letter (Ls, Mm, km); null when it is not one. */
export function readDistanceLine(
  rgba: Rgba,
  w: number,
  line: TextLine,
  glyphs: DistanceGlyphs,
  look: TextLook = ORANGE_LOOK,
  minMatch = DISTANCE_MIN_MATCH,
): TargetDistance | null {
  const cut = cutDistanceLine(rgba, w, line, look);
  if (!cut) return null;
  const m = (v: number[], g: DistanceGlyphs["tall"]) => matchGlyph(v, g, minMatch);
  const unit = `${m(cut.cap, glyphs.tall) ?? "?"}${m(cut.small, glyphs.small) ?? "?"}`;
  if (unit !== "Ls" && unit !== "Mm" && unit !== "km") return null;
  let digits = "";
  for (const f of cut.figures) {
    const d = m(f, glyphs.tall);
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
export function readTargetDistance(
  rgba: Rgba,
  w: number,
  h: number,
  glyphs: DistanceGlyphs,
  screenH = h,
  look: TextLook = ORANGE_LOOK,
  minMatch = DISTANCE_MIN_MATCH,
): TargetDistance | null {
  const lines = findTextLines(rgba, w, h, screenH, look);
  const found: TargetDistance[] = [];
  for (const l of lines) {
    if (!lineUnder(lines, l)) continue;
    const r = readDistanceLine(rgba, w, l, glyphs, look, minMatch);
    if (r) found.push(r);
  }
  return found.length === 1 ? found[0]! : null;
}

/** A line shaped like a distance: 3 to 9 pieces, figures and a capital as tall, a small letter last. */
function distanceShaped(line: TextLine): boolean {
  const p = line.pieces;
  if (p.length < 3 || p.length > 9) return false;
  const tall = (c: Rect) => c.y1 - c.y0 + 1 >= line.dh * 0.82;
  return p.slice(0, -1).every(tall) && !tall(p[p.length - 1]!);
}

/**
 * The colours target lines could be drawn in: every distance-shaped line with the time line under it, found
 * colour-blind (or in the hue of `hint`), gives the colour of its strokes' core (the median of its brightest tenth of
 * pixels). Brightest first.
 */
export function discoverTextColours(rgba: Rgba, w: number, h: number, screenH = h, hint?: Rgb | null): Rgb[] {
  const out: Rgb[] = [];
  for (const finding of hint ? [hueLook(hint)] : FINDING_LOOKS) {
    const lines = findTextLines(rgba, w, h, screenH, finding);
    for (const l of lines) {
      if (!distanceShaped(l) || !lineUnder(lines, l)) continue;
      const c = strokeColour(rgba, w, l.pieces);
      if (!out.some((o) => sameColour(o, c))) out.push(c);
    }
  }
  return out.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]));
}

/**
 * The game's own target text, its strokes' core (the finder's colour on his default shots, median of 87: 250, 215, 0).
 * The colour-blind finder misses it on most of them (the orange glow joins the figures), so it is always tried.
 */
export const DEFAULT_TEXT_COLOUR: Rgb = [250, 215, 0];

/** The colours to read a frame in: those found on it, then the game's default unless one of them is it. */
export function candidateTextColours(rgba: Rgba, w: number, h: number, screenH = h): Rgb[] {
  const found = discoverTextColours(rgba, w, h, screenH);
  const d = DEFAULT_TEXT_COLOUR;
  return found.some((c) => sameColour(c, d, 40)) ? found : [...found, d];
}

/** The orange table's own least match (hudDistanceGlyphsOrange.ts: 214 of 218 held out, no wrong, at 0.75). */
const ORANGE_MIN_MATCH = 0.75;

/**
 * The target's distance in any HUD colour, with the colour it was read in, to keep for the next frames. The game's own
 * orange first, as it always was read (ORANGE_LOOK and `orangeGlyphs`), unless a colour other than the default was
 * learned; then `known` (the colour learned before), else each candidate colour, with `glyphs` (the any-colour table).
 * `hint`, the colour a mod's settings name for the text (EDHM's ini, server edhmColours.ts), is looked for first, by
 * its hue: the lines found in it give the colour; the colour-blind search follows when none reads (a stale hint), and
 * the game's orange goes last.
 */
export function readTargetDistanceAnyColour(
  rgba: Rgba,
  w: number,
  h: number,
  glyphs: DistanceGlyphs,
  screenH = h,
  known?: Rgb | null,
  orangeGlyphs?: DistanceGlyphs,
  hint?: Rgb | null,
): { reading: TargetDistance; colour: Rgb } | null {
  const d = DEFAULT_TEXT_COLOUR;
  const orange = () => {
    if (!orangeGlyphs || (known && !sameColour(known, d, 40))) return null;
    const reading = readTargetDistance(rgba, w, h, orangeGlyphs, screenH, ORANGE_LOOK, ORANGE_MIN_MATCH);
    return reading ? { reading, colour: d } : null;
  };
  const inColours = (colours: readonly Rgb[]) => {
    for (const c of colours) {
      const reading = readTargetDistance(rgba, w, h, glyphs, screenH, lookFromColour(c));
      if (reading) return { reading, colour: c };
    }
    return null;
  };
  if (known) return orange() ?? inColours([known]);
  if (!hint) return orange() ?? inColours(candidateTextColours(rgba, w, h, screenH));
  const hinted = discoverTextColours(rgba, w, h, screenH, hint);
  return (
    inColours(hinted) ??
    inColours(candidateTextColours(rgba, w, h, screenH).filter((c) => !hinted.some((o) => sameColour(o, c)))) ??
    orange()
  );
}

/** The part of a screen the reader looks in, in pixels of a `w` x `h` screen. */
export function distanceArea(w: number, h: number): { x: number; y: number; w: number; h: number } {
  const x = Math.round(w * AREA.x0);
  const y = Math.round(h * AREA.y0);
  return { x, y, w: Math.round(w * AREA.x1) - x, h: Math.round(h * AREA.y1) - y };
}
