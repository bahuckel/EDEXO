/**
 * How the screen readers (hudPitchReader.ts, hudTargetDistance.ts) see the HUD's text: which pixels are text, and how
 * much of a stroke each holds (the glyph images). The game's own HUD is yellow and orange; EDHM and the like draw it in
 * any colour, white or grey often (owner 2026-11-06, his EDHM shots), so the readers learn the colour from the screen
 * and read in it (lookFromColour).
 */
export interface TextLook {
  isText(r: number, g: number, b: number): boolean;
  ink(r: number, g: number, b: number): number;
}
export type Rgb = readonly [number, number, number];
type Rgba = Uint8Array | Uint8ClampedArray;

/**
 * Colour-blind, for finding: bright and either coloured or near white. Where the text can be is decided by its shape
 * (a distance line, a pair of framed pitch boxes), never by its colour.
 */
export const findingLook = (bright: number, colourful: number): TextLook => ({
  isText: (r, g, b) => {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    return mx >= bright && (mx - mn >= colourful || mn >= bright);
  },
  ink: (r, g, b) => Math.max(0, Math.min(1, (Math.max(r, g, b) - 90) / 150)),
});

/**
 * Text in this colour (the strokes' core): a pixel within 28 % of it is text; the ink falls from 1 at the colour to 0
 * at 60 % of its brightness away, so the glow round a stroke counts for little, as the orange ink did. (Matching the
 * colour's hue at lower brightness as well found fewer lines on his EDHM shots: 135 against 170 of 175.)
 */
export function lookFromColour(c: Rgb): TextLook {
  const n = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1;
  // Squared distances: Math.hypot was five times the cost on every pixel (review 2026-11-07, 9.7 against 1.8 ms).
  const near = (0.28 * n) ** 2;
  const d2 = (r: number, g: number, b: number) => (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
  return {
    isText: (r, g, b) => d2(r, g, b) <= near,
    ink: (r, g, b) => Math.max(0, Math.min(1, 1 - Math.sqrt(d2(r, g, b)) / (0.6 * n))),
  };
}

/**
 * Text near a colour a mod's settings name (EDHM's ini, 2026-11-07): the same hue, the brightness free. The game draws a
 * theme's colour in its own hue but not its value: his EDHM shots, ini 243 grey on screen 150 gear up and 239 gear
 * down, (112, 48, 160) as (95, 14, 197); within 0.95 of the colour's direction on all ten themes measured. A pixel is
 * text if it points the same way (cosine 0.95) and is at least 40 % as bright; for finding only, the colour itself is
 * then learned from the strokes (strokeColour).
 */
export function hueLook(c: Rgb): TextLook {
  const n = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1;
  const u = [c[0] / n, c[1] / n, c[2] / n] as const;
  const along = (r: number, g: number, b: number) => r * u[0] + g * u[1] + b * u[2];
  return {
    isText: (r, g, b) => {
      const a = along(r, g, b);
      if (a < 0.4 * n) return false;
      return a * a >= 0.9025 * (r * r + g * g + b * b);
    },
    ink: (r, g, b) => Math.max(0, Math.min(1, (along(r, g, b) - 0.3 * n) / (0.5 * n))),
  };
}

/** Two colours alike (the same HUD colour found twice). */
export const sameColour = (a: Rgb, b: Rgb, within = 30) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < within * within;

/**
 * Most of an area marked as text: a look that matches the ground (bright terrain, a grey HUD over grey rock). HUD text
 * is sparse, and finding pieces in a dense mask took 200-350 ms a frame (review 2026-11-07), so the readers give up
 * on it ("not sure") past this share.
 */
export const MAX_TEXT_SHARE = 0.12;

/** The colour of the strokes' core in these boxes of a frame: the median of their brightest tenth of pixels. */
export function strokeColour(rgba: Rgba, w: number, boxes: readonly { x0: number; y0: number; x1: number; y1: number }[]): Rgb {
  const px: [number, number, number, number][] = [];
  for (const c of boxes)
    for (let y = c.y0; y <= c.y1; y++)
      for (let x = c.x0; x <= c.x1; x++) {
        const i = (y * w + x) * 4;
        const r = rgba[i]!;
        const g = rgba[i + 1]!;
        const b = rgba[i + 2]!;
        px.push([r + g + b, r, g, b]);
      }
  px.sort((a, b) => b[0] - a[0]);
  const top = px.slice(0, Math.max(3, Math.round(px.length / 10)));
  const med = (k: 1 | 2 | 3) => top.map((q) => q[k]).sort((a, b) => a - b)[top.length >> 1]!;
  return [med(1), med(2), med(3)];
}
