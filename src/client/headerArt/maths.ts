/**
 * The header artwork's small maths: repeatable random numbers, value noise (plain and wrapping), and the
 * palette. Every colour of the picture is the scheme's accent turned in hue or stepped in lightness, so a
 * colour scheme changes the whole picture; nothing here names a colour of its own.
 */

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A number from a name (FNV-1a), 1..65536: the same system draws the same skyline on every visit. */
export function seedOf(text: string | null | undefined): number {
  let h = 0x811c9dc5;
  for (const ch of text ?? "") h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return ((h >>> 0) % 65536) + 1;
}

/** A repeatable random sequence (mulberry32): the same seed draws the same picture. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Layered value noise, 0..1. */
export function fbm(x: number, y: number, s: number, oct = 4): number {
  let f = 0;
  let amp = 0.5;
  let sum = 0;
  for (let i = 0; i < oct; i++) {
    f += amp * vnoise(x, y, s + i * 17);
    sum += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return f / sum;
}

function vnoiseP(x: number, y: number, s: number, px: number, py: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const wx = (n: number) => ((n % px) + px) % px;
  const wy = (n: number) => ((n % py) + py) % py;
  const a = hash2(wx(xi), wy(yi), s);
  const b = hash2(wx(xi + 1), wy(yi), s);
  const c = hash2(wx(xi), wy(yi + 1), s);
  const d = hash2(wx(xi + 1), wy(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Layered noise that repeats after 1 in `u` and in `v` (`cx` × `cy` cells at the coarsest layer): no seam. */
export function fbmP(u: number, v: number, s: number, cx: number, cy: number, oct: number): number {
  let f = 0;
  let amp = 0.5;
  let sum = 0;
  for (let i = 0; i < oct; i++) {
    const px = cx << i;
    const py = cy << i;
    f += amp * vnoiseP(u * px, v * py, s + i * 17, px, py);
    sum += amp;
    amp *= 0.5;
  }
  return f / sum;
}

/** The most the land rises in a header `h` px tall. The sky's subjects are aimed against it, so it depends on nothing else. */
export const landCap = (h: number): number => clamp(h * 0.44, 26, 118);

export type Rgb = [number, number, number];

function rgbToHsl([r0, g0, b0]: Rgb): Rgb {
  const r = r0 / 255;
  const g = g0 / 255;
  const b = b0 / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: Rgb): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export interface Palette {
  /** The accent turned by `dh` degrees, its saturation times `sm`, at lightness `l` (0..1). */
  raw(dh: number, sm: number, l: number): Rgb;
  css(c: Rgb, a?: number): string;
  /** `raw` as a CSS colour. */
  c(dh: number, sm: number, l: number, a?: number): string;
}

/** The whole picture's colours from the one accent ("r, g, b" as in `--accent-rgb`). */
export function palette(rgbText: string): Palette {
  const p = rgbText.split(",").map((v) => Number(v.trim()) || 0);
  const [h, s] = rgbToHsl([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
  const raw = (dh: number, sm: number, l: number): Rgb => hslToRgb([(((h + dh) % 360) + 360) % 360, clamp(s * sm, 0, 1), l]);
  const css = (c: Rgb, a = 1): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  return { raw, css, c: (dh, sm, l, a = 1) => css(raw(dh, sm, l), a) };
}
