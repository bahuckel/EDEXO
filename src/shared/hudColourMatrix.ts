/**
 * Elite's custom HUD colour (owner 2026-11-06: a commander's recoloured HUD was not read, "I immediately got a
 * complaint about it"). The game recolours its HUD with a 3 x 3 matrix in GraphicsConfigurationOverride.xml
 * (Options\Graphics): GUIColour > Default > MatrixRed / MatrixGreen / MatrixBlue, three numbers each. A HUD pixel of the
 * default look (r, g, b) is drawn as r * MatrixRed + g * MatrixGreen + b * MatrixBlue. The screen readers
 * (hudPitchReader.ts, hudTargetDistance.ts) know the default look only, so a frame is brought back to it with the
 * inverse before reading: their glyphs and colour tests stay as they are.
 */

/** Rows MatrixRed, MatrixGreen, MatrixBlue: where the default look's red, green and blue go. */
export type HudColourMatrix = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

export const IDENTITY_HUD_MATRIX: HudColourMatrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** The matrix in a GraphicsConfigurationOverride.xml's text; null when it sets none (the default look) or is unreadable. */
export function parseHudColourMatrix(xml: string): HudColourMatrix | null {
  const block = /<GUIColour>[\s\S]*?<Default>([\s\S]*?)<\/Default>/i.exec(xml)?.[1];
  if (!block) return null;
  const row = (tag: string): [number, number, number] | null => {
    const m = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i").exec(block);
    const v = m?.[1]?.split(",").map((x) => Number(x.trim()));
    return v && v.length === 3 && v.every((x) => Number.isFinite(x)) ? [v[0]!, v[1]!, v[2]!] : null;
  };
  const r = row("MatrixRed");
  const g = row("MatrixGreen");
  const b = row("MatrixBlue");
  return r && g && b ? [r, g, b] : null;
}

export function isIdentityHudMatrix(m: HudColourMatrix): boolean {
  return m.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-6));
}

/** The default look's pixel as the game draws it with `m`. */
export function applyHudMatrix(m: HudColourMatrix, r: number, g: number, b: number): [number, number, number] {
  const [mr, mg, mb] = m;
  return [r * mr[0] + g * mg[0] + b * mb[0], r * mr[1] + g * mg[1] + b * mb[1], r * mr[2] + g * mg[2] + b * mb[2]];
}

/** The inverse, to bring a recoloured pixel back; null when the matrix loses a colour (determinant near 0). */
export function invertHudMatrix(m: HudColourMatrix): HudColourMatrix | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 0.05) return null;
  const k = 1 / det;
  return [
    [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
    [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
    [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k],
  ];
}

/**
 * The default look's brightest text: the pitch boxes' yellow cores and the target line's orange (hudPitchReader.ts
 * isDigitPx, hudTargetDistance.ts isTextPx), at their top.
 */
const BRIGHTEST_TEXT: readonly (readonly [number, number, number])[] = [
  [255, 235, 10],
  [255, 160, 30],
];

/**
 * Whether the readers can read a HUD drawn with `m`: "default" (nothing to do), "undo" (the inverse brings each frame
 * back), "unsupported" (left unread rather than misread).
 *
 * Measured with scripts/hud-colour-bench.ts on the owner's labelled shots (2026-11-06): channel swaps and a common
 * blue HUD (MatrixRed 0,0.47,1 / MatrixGreen 0,0.37,0 / MatrixBlue 1,0,0) undo with no wrong read (distance 35-36 of
 * 37, pitch 13-16 of 17). Where the game's clamp at 255 cuts the text (purple pushing yellow to 265, cyan, white) the
 * inverse cannot rebuild it and gave wrong pitch reads; a lookup table built through the clamp gave wrong distance reads.
 */
export type HudColourSupport = "default" | "undo" | "unsupported";

export function hudColourSupport(m: HudColourMatrix | null | undefined): HudColourSupport {
  if (!m || isIdentityHudMatrix(m)) return "default";
  if (!invertHudMatrix(m)) return "unsupported";
  for (const [r, g, b] of BRIGHTEST_TEXT) if (applyHudMatrix(m, r, g, b).some((v) => v > 255.5 || v < -0.5)) return "unsupported";
  return "undo";
}

/** Recolour an RGBA buffer in place with `m` (the inverse brings a frame back to the default look), clamped to 0-255. */
export function recolourRgba(rgba: Uint8Array | Uint8ClampedArray, m: HudColourMatrix): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = applyHudMatrix(m, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    rgba[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    rgba[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    rgba[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}
