/**
 * The Nebula style's sky (owner 2026-11-16: "as a real nebula, like the combination of crab, helix, ring nebulas in
 * the top left, top right and middle down", natural colours, drawn in code after the real photos). Three planetary
 * and supernova remnants on a star field, painted once per screen size into a pixel buffer: no page, no canvas, so
 * it runs in a worker (worker.ts) and in a test alike. Each nebula is light added in linear terms, then the whole
 * picture is tone-mapped, as a long exposure would be.
 *
 *   Crab (M1), top left     a lumpy oval: a blue glow inside a net of filaments, yellow-white within, orange-brown out
 *   Helix (NGC 7293), right a blue disk, a thin yellow inner edge, a thick red ring of radial knots, a faint outer loop
 *   Ring (M57), bottom      a tilted oval: blue middle, a teal then yellow-white band, a fuzzy orange-red rim
 */
import { TAU, clamp, rng, sstep } from "../headerArt/maths";

export interface NebulaPicture {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray<ArrayBuffer>;
}

type Rgb = [number, number, number];

/* ---- gradient noise (Perlin), -1..1, seeded ---- */

function makeNoise(seed: number): (x: number, y: number) => number {
  const r = rng(seed);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j]!, base[i]!];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]!;
  const gx = new Float32Array(8);
  const gy = new Float32Array(8);
  for (let i = 0; i < 8; i++) {
    gx[i] = Math.cos((i * TAU) / 8);
    gy[i] = Math.sin((i * TAU) / 8);
  }
  const grad = (h: number, x: number, y: number) => gx[h & 7]! * x + gy[h & 7]! * y;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = p[p[X]! + Y]!;
    const ba = p[p[X + 1]! + Y]!;
    const ab = p[p[X]! + Y + 1]!;
    const bb = p[p[X + 1]! + Y + 1]!;
    const x1 = grad(aa, xf, yf) + (grad(ba, xf - 1, yf) - grad(aa, xf, yf)) * u;
    const x2 = grad(ab, xf, yf - 1) + (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1)) * u;
    return (x1 + (x2 - x1) * v) * 1.4;
  };
}

type Noise = (x: number, y: number) => number;

/** Layered noise, about -1..1. */
function fbm(n: Noise, x: number, y: number, oct: number): number {
  let f = 0;
  let amp = 0.5;
  let sum = 0;
  for (let i = 0; i < oct; i++) {
    f += amp * n(x, y);
    sum += amp;
    x = x * 2.02 + 17.3;
    y = y * 2.02 - 9.1;
    amp *= 0.5;
  }
  return f / sum;
}

/** Ridged multifractal: each layer's lines grow where the last one's are, so filaments branch from filaments. */
function web(n: Noise, x: number, y: number, oct: number, sharp: number): number {
  let f = 0;
  let w = 1;
  let amp = 1;
  let sum = 0;
  for (let i = 0; i < oct; i++) {
    const r = Math.pow(1 - Math.min(1, Math.abs(n(x, y))), sharp);
    f += r * w * amp;
    sum += amp;
    w = clamp(r * 1.6, 0, 1);
    x = x * 2.1 + 5.3;
    y = y * 2.1 - 2.7;
    amp *= 0.55;
  }
  return f / sum;
}

const gauss = (x: number, mid: number, w: number): number => {
  const d = (x - mid) / w;
  return Math.exp(-d * d);
};

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* ---- the three nebulae: each returns the light at a point in its own frame (radius 1) ---- */

interface Placed {
  cx: number;
  cy: number;
  /** Pixels per unit of the nebula's own frame. */
  r: number;
  rot: number;
  /** How far out (in its radii) it still gives light. */
  reach: number;
  light(x: number, y: number, out: Float32Array): void;
}

function crab(n: Noise, m: Noise): Placed["light"] {
  const blue: Rgb = [0.3, 0.55, 1.0];
  const inner: Rgb = [1.0, 0.95, 0.72];
  const green: Rgb = [0.72, 1.0, 0.55];
  const outer: Rgb = [1.0, 0.4, 0.12];
  const brown: Rgb = [0.7, 0.28, 0.1];
  return (x, y, out) => {
    const ex = x / 1.22;
    const ey = y / 0.92;
    // A lumpy outline: the frame itself is pushed about.
    const wx = ex + 0.2 * fbm(n, ex * 1.2 + 3.1, ey * 1.2, 4);
    const wy = ey + 0.2 * fbm(n, ex * 1.2, ey * 1.2 + 7.7, 4);
    // Lobes: the outline bulges and dents as the real one does.
    const lobe = fbm(m, (wx / (Math.hypot(wx, wy) + 1e-6)) * 1.6 + 20, (wy / (Math.hypot(wx, wy) + 1e-6)) * 1.6, 3);
    const rr = Math.hypot(wx, wy) * (1 - 0.14 * lobe);
    if (rr > 1.3) return;
    const env = sstep(1.0, 0.62, rr);
    // Where the net is thick and where it is open: dark gaps through the glow too.
    const patch = 0.45 + 0.55 * sstep(-0.3, 0.3, fbm(m, ex * 2.1 + 11, ey * 2.1, 3));
    // The synchrotron glow: blue, brightest in the middle, mottled.
    const g = env * (0.35 + 0.65 * patch) * (0.55 + 0.45 * fbm(m, ex * 4, ey * 4, 3)) * (1.1 - 0.55 * rr);
    out[0] = out[0]! + blue[0] * g * 0.75;
    out[1] = out[1]! + blue[1] * g * 0.75;
    out[2] = out[2]! + blue[2] * g * 0.75;
    // The filaments: a branching net in a gently warped frame.
    const q1 = fbm(m, ex * 2.4 + 1.7, ey * 2.4, 3);
    const q2 = fbm(m, ex * 2.4, ey * 2.4 + 4.3, 3);
    const net = web(n, (wx + 0.25 * q1) * 5, (wy + 0.25 * q2) * 5, 4, 5);
    const fine = web(m, (wx - 0.2 * q2) * 10, (wy + 0.2 * q1) * 10, 3, 7);
    const fe = sstep(1.12, 0.9, rr) * (0.35 + 0.65 * sstep(0.1, 0.8, rr));
    const fil = (net * net * 1.9 + fine * fine * 0.8) * fe * patch;
    const t = clamp(sstep(0.32, 0.92, rr + 0.18 * q1), 0, 1);
    const c = mix(mix(inner, green, clamp(0.5 + q2, 0, 1) * 0.5), mix(outer, brown, sstep(0.85, 1.05, rr)), t);
    out[0] = out[0]! + c[0] * fil;
    out[1] = out[1]! + c[1] * fil;
    out[2] = out[2]! + c[2] * fil;
    // An orange haze toward the rim.
    const h = env * sstep(0.45, 0.95, rr) * (0.5 + 0.5 * q1) * 0.22;
    out[0] = out[0]! + 0.95 * h;
    out[1] = out[1]! + 0.36 * h;
    out[2] = out[2]! + 0.1 * h;
  };
}

function helix(n: Noise, m: Noise): Placed["light"] {
  const disk: Rgb = [0.3, 0.52, 0.92];
  const edge: Rgb = [1.0, 0.86, 0.5];
  const orange: Rgb = [1.0, 0.48, 0.17];
  const red: Rgb = [0.85, 0.17, 0.07];
  return (x, y, out) => {
    const ex = x;
    const ey = y / 0.9;
    const wx = ex + 0.06 * fbm(n, ex * 2 + 5, ey * 2, 3);
    const wy = ey + 0.06 * fbm(n, ex * 2, ey * 2 + 2, 3);
    const rr = Math.hypot(wx, wy);
    const th = Math.atan2(wy, wx);
    if (rr < 1.6) {
      // The disk: blue, mottled, a little darker at the middle.
      const d = (0.25 + 0.6 * sstep(0.05, 0.58, rr)) * sstep(0.66, 0.52, rr) * (0.5 + 0.5 * fbm(m, ex * 3.5, ey * 3.5, 5));
      out[0] = out[0]! + disk[0] * d * 0.7;
      out[1] = out[1]! + disk[1] * d * 0.7;
      out[2] = out[2]! + disk[2] * d * 0.7;
      // Radial knots: noise long along the radius, short around it, seamless around the circle.
      const kA = fbm(n, Math.cos(th) * 26 + rr * 2.2, Math.sin(th) * 26 + rr * 2.2, 3);
      const kB = fbm(m, Math.cos(th) * 60 + rr * 1.3, Math.sin(th) * 60 - rr * 1.3, 2);
      const knots = clamp(0.5 + 0.7 * kA + 0.35 * kB, 0, 1.4);
      const clump = 0.5 + 0.5 * fbm(n, ex * 5.5 + 3, ey * 5.5, 4);
      // The thin yellow-white inner edge, in patches.
      const e = gauss(rr, 0.575, 0.05) * (0.25 + 0.9 * clump) * (0.7 + 0.4 * knots) * 0.6;
      out[0] = out[0]! + edge[0] * e;
      out[1] = out[1]! + edge[1] * e;
      out[2] = out[2]! + edge[2] * e;
      // The thick red ring, brighter lower left and right.
      const thick = 0.92 + 0.1 * Math.cos(th - 2.3) + 0.08 * fbm(m, Math.cos(th) * 2, Math.sin(th) * 2, 2);
      const prof = sstep(0.54, 0.68, rr) * sstep(thick + 0.08, thick - 0.24, rr);
      const asym = 0.6 + 0.3 * Math.cos(th - 2.3) + 0.2 * Math.cos(2 * th + 0.4) + 0.4 * fbm(m, ex * 1.6, ey * 1.6, 3);
      const streak = 1 + 0.45 * (knots - 0.5) * gauss(rr, 0.66, 0.12);
      const ring = prof * Math.max(0, asym) * (0.25 + 1.0 * clump * clump) * streak;
      const c = mix(orange, red, sstep(0.6, 0.95, rr));
      out[0] = out[0]! + c[0] * ring * 1.05;
      out[1] = out[1]! + c[1] * ring * 1.05;
      out[2] = out[2]! + c[2] * ring * 1.05;
    }
    // The faint outer loop, set off to the upper left, strongest there.
    const ox = wx + 0.13;
    const oy = wy + 0.11;
    const r2 = Math.hypot(ox / 1.06, oy);
    const t2 = Math.atan2(oy, ox);
    const loop =
      gauss(r2 + 0.08 * fbm(n, ox * 3, oy * 3, 3), 1.18, 0.11) *
      clamp(0.35 + 0.65 * Math.cos(t2 + 2.4), 0, 1) *
      (0.4 + 0.8 * (0.5 + 0.5 * fbm(m, ox * 5, oy * 5, 4))) *
      0.5;
    out[0] = out[0]! + 0.85 * loop;
    out[1] = out[1]! + 0.2 * loop;
    out[2] = out[2]! + 0.08 * loop;
    // A red haze all round.
    const halo = sstep(1.55, 0.85, rr) * 0.07 * (0.6 + 0.4 * fbm(n, ex * 2, ey * 2, 2));
    out[0] = out[0]! + 0.7 * halo;
    out[1] = out[1]! + 0.14 * halo;
    out[2] = out[2]! + 0.06 * halo;
  };
}

function ring(n: Noise, m: Noise): Placed["light"] {
  const blue: Rgb = [0.2, 0.42, 0.95];
  const teal: Rgb = [0.42, 0.82, 0.66];
  const yellow: Rgb = [1.0, 0.92, 0.62];
  const orange: Rgb = [1.0, 0.42, 0.12];
  return (x, y, out) => {
    const ex = x / 0.74;
    const ey = y;
    const wx = ex + 0.045 * fbm(n, ex * 3, ey * 3, 3);
    const wy = ey + 0.045 * fbm(n, ex * 3 + 4, ey * 3, 3);
    const rr = Math.hypot(wx, wy);
    if (rr > 1.7) return;
    const grain = 0.35 + 0.9 * (0.5 + 0.5 * fbm(m, ex * 14, ey * 14, 4));
    const lanes = 0.5 + 0.5 * (0.5 + 0.5 * fbm(n, ex * 3.2 + 2, ey * 6.5, 4));
    const b = sstep(0.68, 0.45, rr) * lanes * (0.6 + 0.6 * rr) * 0.85;
    out[0] = out[0]! + blue[0] * b;
    out[1] = out[1]! + blue[1] * b;
    out[2] = out[2]! + blue[2] * b;
    const t = gauss(rr, 0.6, 0.1) * 0.45 * grain;
    out[0] = out[0]! + teal[0] * t;
    out[1] = out[1]! + teal[1] * t;
    out[2] = out[2]! + teal[2] * t;
    const yv = gauss(rr, 0.72, 0.1) * 1.1 * grain;
    out[0] = out[0]! + yellow[0] * yv;
    out[1] = out[1]! + yellow[1] * yv;
    out[2] = out[2]! + yellow[2] * yv;
    const o = sstep(0.66, 0.82, rr) * sstep(1.2, 0.8, rr) * (0.35 + 0.8 * (0.5 + 0.5 * fbm(n, ex * 7, ey * 7, 4))) * 0.9;
    out[0] = out[0]! + orange[0] * o;
    out[1] = out[1]! + orange[1] * o;
    out[2] = out[2]! + orange[2] * o;
    // The faint outer halo, in petals.
    const th = Math.atan2(wy, wx);
    const pet = 0.5 + 0.5 * fbm(m, Math.cos(th) * 4 + rr, Math.sin(th) * 4 + rr, 3);
    const halo = sstep(1.6, 1.0, rr) * sstep(0.85, 1.05, rr) * pet * 0.16;
    out[0] = out[0]! + 0.8 * halo;
    out[1] = out[1]! + 0.2 * halo;
    out[2] = out[2]! + 0.08 * halo;
  };
}

/* ---- the picture ---- */

/** The sky for a screen `width` × `height`. `scale` (≤ 1) paints the nebulae at fewer pixels, smoothed up. */
export function paintNebulaSky(width: number, height: number, scale = 0.5): NebulaPicture {
  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(height));
  const acc = new Float32Array(W * H * 3);
  const n = makeNoise(1054);
  const m = makeNoise(7293);
  const u = Math.min(W, H * 1.6);
  const placed: Placed[] = [
    { cx: W * 0.19, cy: H * 0.26, r: u * 0.17, rot: -0.45, reach: 1.35, light: crab(n, m) },
    { cx: W * 0.84, cy: H * 0.27, r: u * 0.17, rot: 0.25, reach: 1.65, light: helix(n, m) },
    { cx: W * 0.5, cy: H * 0.83, r: u * 0.13, rot: 0.35, reach: 1.75, light: ring(n, m) },
  ];

  const sw = Math.max(1, Math.round(W * scale));
  const sh = Math.max(1, Math.round(H * scale));
  const low = new Float32Array(sw * sh * 3);
  const px = new Float32Array(3);
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      const X = (i + 0.5) / scale;
      const Y = (j + 0.5) / scale;
      // Faint hydrogen (red) and dust lit blue, wide and soft: glass over "empty" sky still has a colour to frost.
      const hx = X / u;
      const hy = Y / u;
      const red = sstep(-0.05, 0.55, fbm(n, hx * 1.6 + 31, hy * 1.6, 5));
      const dust = sstep(-0.1, 0.5, fbm(m, hx * 1.3 - 8, hy * 1.3 + 4, 5));
      const v = 0.5 + 0.5 * fbm(m, hx * 2.2, hy * 2.2, 4);
      const veil = v * v * 0.03;
      const o = (j * sw + i) * 3;
      low[o] = veil * 0.55 + red * red * 0.28 + dust * dust * 0.06;
      low[o + 1] = veil * 0.35 + red * red * 0.04 + dust * dust * 0.11;
      low[o + 2] = veil * 0.9 + red * red * 0.05 + dust * dust * 0.3;
    }
  }
  for (const p of placed) {
    const ext = p.r * p.reach * 1.35;
    const i0 = Math.max(0, Math.floor((p.cx - ext) * scale));
    const i1 = Math.min(sw - 1, Math.ceil((p.cx + ext) * scale));
    const j0 = Math.max(0, Math.floor((p.cy - ext) * scale));
    const j1 = Math.min(sh - 1, Math.ceil((p.cy + ext) * scale));
    const cs = Math.cos(-p.rot);
    const sn = Math.sin(-p.rot);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = ((i + 0.5) / scale - p.cx) / p.r;
        const dy = ((j + 0.5) / scale - p.cy) / p.r;
        if (dx * dx + dy * dy > p.reach * p.reach * 1.8) continue;
        px[0] = px[1] = px[2] = 0;
        p.light(dx * cs - dy * sn, dx * sn + dy * cs, px);
        const o = (j * sw + i) * 3;
        low[o] = low[o]! + px[0];
        low[o + 1] = low[o + 1]! + px[1];
        low[o + 2] = low[o + 2]! + px[2];
      }
    }
  }
  // Smoothed up to the full size.
  for (let y = 0; y < H; y++) {
    const fy = clamp((y + 0.5) * scale - 0.5, 0, sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = clamp((x + 0.5) * scale - 0.5, 0, sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = (y0 * sw + x0) * 3;
      const b = (y0 * sw + x1) * 3;
      const c = (y1 * sw + x0) * 3;
      const d = (y1 * sw + x1) * 3;
      const o = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) {
        const top = low[a + k]! + (low[b + k]! - low[a + k]!) * tx;
        const bot = low[c + k]! + (low[d + k]! - low[c + k]!) * tx;
        acc[o + k] = top + (bot - top) * ty;
      }
    }
  }

  // Stars at full size: many faint, few bright; the brightest with four spikes, as a telescope draws them.
  const r = rng(4021);
  const tints: Rgb[] = [
    [0.75, 0.85, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.95, 0.82],
    [1.0, 0.82, 0.6],
  ];
  const splat = (sx: number, sy: number, rad: number, tint: Rgb, power: number) => {
    const reach = Math.ceil(rad * 3);
    const x0 = Math.max(0, Math.floor(sx - reach));
    const x1 = Math.min(W - 1, Math.ceil(sx + reach));
    const y0 = Math.max(0, Math.floor(sy - reach));
    const y1 = Math.min(H - 1, Math.ceil(sy + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = ((x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2) / (rad * rad);
        if (d2 > 9) continue;
        const v = Math.exp(-d2) * power;
        const o = (y * W + x) * 3;
        acc[o] = acc[o]! + tint[0] * v;
        acc[o + 1] = acc[o + 1]! + tint[1] * v;
        acc[o + 2] = acc[o + 2]! + tint[2] * v;
      }
    }
  };
  const count = Math.round((W * H) / 700);
  for (let s = 0; s < count; s++) {
    const sx = r() * W;
    const sy = r() * H;
    const b = Math.pow(r(), 9);
    const tint = tints[Math.floor(r() * tints.length)]!;
    splat(sx, sy, 0.55 + b * 1.4, tint, 0.18 + b * 2.6);
    if (b > 0.62) {
      // Spikes and a soft glow.
      splat(sx, sy, 4 + b * 5, tint, 0.05 * b);
      const len = 5 + b * 18;
      for (let t = 1; t < len; t++) {
        const f = 0.32 * b * Math.pow(1 - t / len, 2);
        for (const [ddx, ddy] of [
          [t, 0],
          [-t, 0],
          [0, t],
          [0, -t],
        ] as const) {
          const xx = Math.round(sx + ddx);
          const yy = Math.round(sy + ddy);
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const o = (yy * W + xx) * 3;
          acc[o] = acc[o]! + tint[0] * f;
          acc[o + 1] = acc[o + 1]! + tint[1] * f;
          acc[o + 2] = acc[o + 2]! + tint[2] * f;
        }
      }
    }
  }
  // The central stars of the two planetary nebulae.
  const [, helixAt, ringAt] = placed as [Placed, Placed, Placed];
  splat(helixAt.cx, helixAt.cy, 1.6, [0.85, 0.92, 1.0], 1.4);
  splat(ringAt.cx, ringAt.cy, 1.2, [0.85, 0.92, 1.0], 1.0);

  // A long exposure's curve: bright parts roll off instead of clipping.
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0, o = 0; i < W * H * 3; i += 3, o += 4) {
    data[o] = 255 * (1 - Math.exp(-acc[i]! * 1.6));
    data[o + 1] = 255 * (1 - Math.exp(-acc[i + 1]! * 1.6));
    data[o + 2] = 255 * (1 - Math.exp(-acc[i + 2]! * 1.6));
    data[o + 3] = 255;
  }
  return { width: W, height: H, data };
}
