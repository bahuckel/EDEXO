/**
 * Two round digits the pitch reader's glyphs score about the same, told apart by their strokes (hudPitchReader.ts
 * readBox): 6, 8 and 9 by where a stroke dips, 0 and 8 by the stroke across the middle. Split from the reader for its
 * size cap.
 */
type Rgba = Uint8Array | Uint8ClampedArray;
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Which of 6, 8 and 9 a digit is by its strokes, for two of them its glyph cannot tell apart (2026-11-13: 49 of 742
 * labelled shots were not sure only for that; a glow fills a 6's gap or a 9's). Each row's brightest pixel (raw: a
 * theme's ink saturates in the glow) in the digit's right third and in its left third: a 6's right stroke dips in its
 * upper part, a 9's left stroke in its lower part, an 8's run full on both sides. Dip below 0.90 of the stroke's own
 * other part, full above 0.985 (measured on the labelled shots read right); between, or anything else, null. 0 is left
 * out: this font's 0 is not hollow in its middle either. On the 49: 28 right, 0 wrong, 21 still not sure.
 */
export function strokeDigit(rgba: Rgba, w: number, c: Rect): "6" | "8" | "9" | null {
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
export function slashDigit(rgba: Rgba, w: number, c: Rect): "0" | "8" | null {
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
