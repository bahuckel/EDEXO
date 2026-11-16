/**
 * The header artwork's land: two far ranges, mist, middle hills, and the ground the plants stand on. It stands
 * still while the sky turns. Its skyline is the system's own (the seed), its build follows the kind of body on
 * show (icy: sharp ranges; rocky: craters; metal-rich: mesas), and the plants are the genera the app predicts or
 * has found there (owner, 2026-11-16) — a body without biology is bare ground.
 */
import { ctx2d, layerCanvas, newCanvas, type AnyCanvas, type Ctx } from "./canvas";
import { envelope, type Layout } from "./layout";
import { TAU, clamp, fbm, lerp, rng, sstep, type Palette } from "./maths";
import { PLANT, PLANT_H, type Glint, type PlantKind } from "./plants";

type Vec3 = [number, number, number];
type Height = (x: number) => number;

/** How the land is built, from the body's kind. */
export type LandStyle = "plain" | "icy" | "rocky" | "metal";

/** The journal's `PlanetClass` ("Icy body", "Rocky ice body", "High metal content body", "Rocky body", …). */
export function landStyleOf(planetClass: string | null | undefined): LandStyle {
  const c = (planetClass ?? "").toLowerCase();
  if (c.includes("icy") || c.includes("ice")) return "icy";
  if (c.includes("metal")) return "metal";
  if (c.includes("rocky")) return "rocky";
  return "plain";
}

export interface Land {
  w: number;
  h: number;
  env: Float32Array;
  /** The most the land rises anywhere. */
  cap: number;
  E: Height;
  /** The free part of the bottom edge, where the land climbs and the plants stand. */
  pk0: number;
  pk1: number;
  hasPeak: boolean;
  pkC: number;
  pkW: number;
  /** Four lines, farthest first: a pale high range, the sharp range, the middle hills, the plants' ground. */
  hFar2: Height;
  hFar: Height;
  hMid: Height;
  hNear: Height;
  ridgePath(ctx: Ctx, fn: Height): void;
}

export function landModel(L: Layout, seed: number, style: LandStyle = "plain", flat = false): Land {
  const { w, h } = L;
  const { env, cap } = envelope(L, flat);
  const E: Height = (x) => env[clamp(Math.round(x), 0, env.length - 1)]!;
  let pk0 = 0;
  let pk1 = 0;
  let run = -1;
  for (let x = 0; x <= w; x++) {
    const on = E(x) > Math.max(22, cap * 0.45);
    if (on && run < 0) run = x;
    if ((!on || x === Math.floor(w)) && run >= 0) {
      if (x - run > pk1 - pk0) {
        pk0 = run;
        pk1 = x;
      }
      run = -1;
    }
  }
  const hasPeak = pk1 - pk0 > 90;
  const s1 = seed * 3 + 1;
  const s2 = seed * 5 + 2;
  const s3 = seed * 11 + 3;
  const ridged = (x: number, f: number, s: number) => 1 - Math.abs(2 * fbm(x * f, 1.7, s, 5) - 1);
  // Flat tops and steep sides: three terraces.
  const mesa = (t: number) => (Math.floor(t * 3) + sstep(0.72, 0.98, t * 3 - Math.floor(t * 3))) / 3;
  // Bowls with raised rims, a few across the header; `k` scales them.
  const bowls = (salt: number, k: number): Height => {
    const r = rng(seed * 131 + salt);
    const list: [number, number][] = [];
    for (let i = 0, n = Math.max(2, Math.round(w / 240)); i < n; i++) list.push([r() * w, 16 + r() * 44]);
    return (x) => {
      let v = 0;
      for (const [cx, rad] of list) {
        const d = Math.abs(x - cx);
        if (d < rad) v -= rad * 0.22 * (1 - (d / rad) ** 2);
        v += rad * 0.07 * Math.exp(-(((d - rad) / (0.2 * rad)) ** 2));
      }
      return v * k;
    };
  };
  const wave = (x: number) => 0.7 + 0.3 * fbm(x * 0.003, 2.3, s1 + 4, 2);
  const wave2 = (x: number) => 0.62 + 0.38 * fbm(x * 0.0022, 9.3, s1 + 9, 2);
  let hFar2: Height;
  let hFar: Height;
  let hMid: Height = (x) => Math.max(2.5, E(x) * (0.3 + 0.5 * fbm(x * 0.0075, 4.2, s2, 4)));
  let hNear: Height = (x) => Math.max(2, E(x) * (0.2 + 0.26 * fbm(x * 0.0048, 8.8, s3, 3)) + 0.8 * fbm(x * 0.09, 2, s3, 2));
  if (style === "icy") {
    // Sharp: thin high peaks, and splinters on the middle hills.
    hFar2 = (x) => Math.max(3.5, E(x) * (0.28 + 0.7 * Math.pow(ridged(x + 900, 0.009, s1 + 7), 2.1)) * wave2(x));
    hFar = (x) => Math.max(3, E(x) * (0.2 + 0.78 * Math.pow(ridged(x, 0.016, s1), 2.5)) * wave(x));
    const mid = hMid;
    hMid = (x) => mid(x) + E(x) * 0.16 * Math.pow(ridged(x, 0.03, s2 + 5), 3);
  } else if (style === "metal") {
    hFar2 = (x) => Math.max(3.5, E(x) * (0.34 + 0.6 * mesa(Math.pow(ridged(x + 900, 0.0045, s1 + 7), 1.1))) * wave2(x));
    hFar = (x) => Math.max(3, E(x) * (0.26 + 0.68 * mesa(Math.pow(ridged(x, 0.008, s1), 1.2))) * wave(x));
  } else {
    hFar2 = (x) => Math.max(3.5, E(x) * (0.34 + 0.62 * Math.pow(ridged(x + 900, 0.006, s1 + 7), 1.5)) * wave2(x));
    hFar = (x) => Math.max(3, E(x) * (0.26 + 0.7 * Math.pow(ridged(x, 0.011, s1), 1.8)) * wave(x));
  }
  if (style === "rocky") {
    const midBowls = bowls(1, 1);
    const nearBowls = bowls(2, 0.3);
    const mid = hMid;
    const near = hNear;
    hMid = (x) => Math.max(2.5, mid(x) + midBowls(x) * Math.min(1, E(x) / cap));
    hNear = (x) => Math.max(2, near(x) + nearBowls(x) * Math.min(1, E(x) / cap));
  }
  return {
    w,
    h,
    env,
    cap,
    E,
    pk0,
    pk1,
    hasPeak,
    pkC: hasPeak ? (pk0 + pk1) / 2 : w * 0.78,
    pkW: hasPeak ? pk1 - pk0 : 0,
    hFar2,
    hFar,
    hMid,
    hNear,
    ridgePath(ctx, fn) {
      ctx.beginPath();
      ctx.moveTo(-2, h + 2);
      for (let x = -2; x <= w + 2; x += 1.5) ctx.lineTo(x, h - fn(x));
      ctx.lineTo(w + 2, h + 2);
      ctx.closePath();
    },
  };
}

interface RangeLook {
  lit: Vec3;
  dark: Vec3;
  haze: Vec3;
  /** Half-width of the crest's soft edge, px. */
  soft: number;
  mist: number;
  detail: number;
}
const FAR2: RangeLook = { lit: [0, 0.55, 0.135], dark: [0, 0.55, 0.08], haze: [0, 0.8, 0.165], soft: 1.5, mist: 0.9, detail: 0.6 };
const FAR1: RangeLook = { lit: [0, 0.65, 0.15], dark: [0, 0.6, 0.04], haze: [0, 0.8, 0.13], soft: 0.8, mist: 0.8, detail: 1 };

/**
 * A distant range, pixel by pixel (owner, 2026-11-16: the flat far mountain "seems way too sharp and looks out
 * of place"). Slopes that face the light are lighter, gullies run down them, faint strata cross them, the crest
 * is a soft edge, and the foot goes into the mist. Drawn at 1× and scaled up: distance is a little out of focus.
 */
function farRange(lm: Land, pal: Palette, fn: Height, seed: number, o: RangeLook): AnyCanvas {
  const W = Math.ceil(lm.w);
  const H = Math.ceil(lm.cap * 1.08) + 4;
  const cv = newCanvas(W, H);
  const ctx = ctx2d(cv);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const lit = pal.raw(...o.lit);
  const dark = pal.raw(...o.dark);
  const haze = pal.raw(...o.haze);
  let prev = new Float32Array(H);
  let cur = new Float32Array(H);
  let prevFrom = H;
  for (let x = -1; x < W; x++) {
    const top = fn(x);
    const crest = H - top;
    const slope = (fn(x + 2) - fn(x - 2)) / 4;
    const from = Math.max(0, Math.floor(crest - o.soft - 1));
    for (let y = from; y < H; y++) {
      // The height field the gullies are cut from: stretched down the slope, so its folds run from crest to foot.
      const n = fbm(x * 0.05 + (y - crest) * 0.012, (y - crest) * 0.022 + x * 0.004, seed, 4);
      cur[y] = n;
      if (x < 0) continue;
      const dep = clamp((y - crest) / Math.max(8, top), 0, 1);
      // Above where the last column started there is no neighbour to compare with: no fold there.
      const fold = y >= prevFrom ? n - prev[y]! : 0;
      const facing = clamp(0.5 + 0.3 * (slope * 0.55 + fold * 7 * o.detail) + (0.5 - dep) * 0.25, 0, 1);
      const strata = (fbm(x * 0.012, y * 0.33, seed + 3, 2) - 0.5) * 0.3 * o.detail;
      const shade = clamp(facing * 0.85 + strata, 0, 1);
      const mist = sstep(0.1, 1, dep) * o.mist;
      const i = (y * W + x) * 4;
      d[i] = lerp(lerp(dark[0], lit[0], shade), haze[0], mist);
      d[i + 1] = lerp(lerp(dark[1], lit[1], shade), haze[1], mist);
      d[i + 2] = lerp(lerp(dark[2], lit[2], shade), haze[2], mist);
      d[i + 3] = 255 * sstep(-o.soft, o.soft + 0.9, y - crest);
    }
    const t = prev;
    prev = cur;
    cur = t;
    prevFrom = from;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Everything behind the plants' ground: both far ranges, the mist, the middle hills and the small growth on them. */
export function drawBackLand(c: Ctx, lm: Land, pal: Palette, seed: number, rnd: () => number, kinds: readonly PlantKind[]): { f1: AnyCanvas; f2: AnyCanvas } {
  const { w, h, cap } = lm;
  const mist = (top: number, a: number) => {
    const g = c.createLinearGradient(0, h - top, 0, h);
    g.addColorStop(0, pal.c(0, 1, 0.55, 0));
    g.addColorStop(1, pal.c(0, 1, 0.55, a));
    c.fillStyle = g;
    c.fillRect(0, h - top, w, top);
  };
  c.save();
  c.imageSmoothingQuality = "high";
  const f2 = farRange(lm, pal, lm.hFar2, seed + 70, FAR2);
  c.drawImage(f2, 0, h - f2.height);
  mist(cap * 0.95, 0.07);
  const f1 = farRange(lm, pal, lm.hFar, seed + 60, FAR1);
  c.drawImage(f1, 0, h - f1.height);
  c.restore();
  mist(cap * 0.8, 0.1);
  lm.ridgePath(c, lm.hMid);
  const g = c.createLinearGradient(0, h - cap, 0, h);
  g.addColorStop(0, pal.c(0, 0.55, 0.066));
  g.addColorStop(1, pal.c(0, 0.55, 0.034));
  c.fillStyle = g;
  c.fill();
  // The same growth, small, on the middle hills: the stand goes on into the distance.
  if (lm.hasPeak && kinds.length) {
    c.fillStyle = c.strokeStyle = pal.c(0, 0.55, 0.055);
    for (let x = lm.pk0 + 20; x < lm.pk1 - 20; x += 16 + rnd() * 46) {
      const k = kinds[(rnd() * kinds.length) | 0]!;
      const s = clamp(cap * 0.13, 5, 13) * (0.7 + rnd() * 0.6);
      c.save();
      c.translate(x, h - lm.hMid(x) + 0.5);
      PLANT[k](c, s * PLANT_H[k], rnd);
      c.restore();
    }
  }
  mist(cap * 0.55, 0.09);
  return { f1, f2 };
}

/** The line-up when nothing says which genera grow here (a preview, a test): one of each of the commoner shapes. */
export const MIXED_PLANTS: readonly PlantKind[] = ["tussock", "stratum", "cactoida", "fungoida", "bacterium", "tubus", "aleoida", "brain", "shards", "frutexa", "osseus", "clypeus", "concha"];

export interface Spot {
  x: number;
  k: PlantKind;
  s: number;
}

/** Where the plants stand along the free part of the ground, and which: `kinds` in turn, the first of them in the middle. */
export function plantSpots(lm: Land, kinds: readonly PlantKind[], rnd: () => number): { spots: Spot[]; hero: Spot | null } {
  const { cap, E, hNear, pk0, pk1, pkC } = lm;
  if (!lm.hasPeak || !kinds.length) return { spots: [], hero: null };
  const base = clamp(cap * 0.5, 15, 50);
  const xs: number[] = [];
  for (let x = pk0 + 22 + rnd() * 14; x < pk1 - 20; x += base * (0.8 + rnd() * 0.9)) xs.push(x);
  if (!xs.length) return { spots: [], hero: null };
  let mid = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - pkC) < Math.abs(xs[mid]! - pkC)) mid = i;
  const spots: Spot[] = [];
  let hero: Spot | null = null;
  xs.forEach((x, i) => {
    const k = kinds[(((i - mid) % kinds.length) + kinds.length) % kinds.length]!;
    const room = E(x) - hNear(x) - 4;
    let s = Math.min(base * (0.5 + rnd() * 0.75), (room / Math.max(0.5, PLANT_H[k])) * 0.92);
    // The one in the middle is the likeliest genus: a little larger, and the sample rings go round it.
    if (i === mid) s = Math.min(Math.max(s, base * 0.9) * 1.2, (E(x) - hNear(x) - 3) / PLANT_H[k]);
    if (s <= 7) return;
    const spot = { x, k, s };
    spots.push(spot);
    if (i === mid) hero = spot;
  });
  return { spots, hero };
}

/** The near ground and the plants as one dark layer, with the places that glow and the plant the rings go round. */
export function plantsLayer(lm: Land, pal: Palette, seed: number, rnd: () => number, dpr: number, kinds: readonly PlantKind[]): { pc: AnyCanvas; glints: Glint[]; hero: Spot | null } {
  const { w, h, hNear } = lm;
  const [pc, px] = layerCanvas(w, h, dpr);
  const near = pal.c(0, 0.45, 0.032);
  px.fillStyle = px.strokeStyle = near;
  lm.ridgePath(px, hNear);
  px.fill();
  const glints: Glint[] = [];
  const { spots, hero } = plantSpots(lm, kinds, rnd);
  for (const p of spots) {
    const y = h - hNear(p.x) + 0.8;
    px.save();
    px.translate(p.x, y);
    px.fillStyle = px.strokeStyle = near;
    const g = PLANT[p.k](px, (p.s * PLANT_H[p.k]) / (p.k === "tubus" ? 1.2 : 1), rng(seed + Math.round(p.x) * 31));
    px.restore();
    for (const q of g) {
      if ("line" in q) glints.push({ line: [p.x + q.line[0], y + q.line[1], p.x + q.line[2], y + q.line[3]], w: q.w });
      else if ("wave" in q) glints.push({ wave: [p.x + q.wave[0], y + q.wave[1], p.x + q.wave[2], y + q.wave[3], q.wave[4]], w: q.w });
      else glints.push({ x: p.x + q.x, y: y + q.y, r: q.r, e: q.e });
    }
  }
  return { pc, glints, hero };
}

/** The sample rings round the one in the middle (the app's own mark) and what glows on the plants. */
export function drawRingsAndGlints(c: Ctx, lm: Land, pal: Palette, dpr: number, hero: Spot | null, glints: Glint[]): void {
  const { h, cap, hNear } = lm;
  if (hero) {
    const y = h - hNear(hero.x) + 1.5;
    const k = clamp(cap / 100, 0.5, 1.15);
    c.save();
    c.setLineDash([3, 4]);
    c.lineWidth = 1;
    const rings: [number, number][] = [
      [36, 0.62],
      [60, 0.42],
    ];
    for (const [rx, a] of rings) {
      c.strokeStyle = pal.c(0, 1, 0.62, a);
      c.beginPath();
      c.ellipse(hero.x, y, rx * k, rx * k * 0.17, 0, 0, TAU);
      c.stroke();
    }
    c.restore();
  }
  c.save();
  c.globalCompositeOperation = "lighter";
  c.shadowColor = pal.c(0, 1, 0.6, 0.9);
  c.shadowBlur = 5 * dpr;
  c.lineCap = "round";
  for (const q of glints) {
    if ("line" in q) {
      c.strokeStyle = pal.c(0, 0.9, 0.74, 0.7);
      c.lineWidth = q.w;
      c.beginPath();
      c.moveTo(q.line[0], q.line[1]);
      c.lineTo(q.line[2], q.line[3]);
      c.stroke();
    } else if ("wave" in q) {
      const [x1, y1, x2, , amp] = q.wave;
      c.strokeStyle = pal.c(0, 0.9, 0.74, 0.75);
      c.lineWidth = q.w;
      c.beginPath();
      for (let t = 0; t <= 1.001; t += 0.1) {
        const X = lerp(x1, x2, t);
        const Y = y1 + Math.sin(t * TAU * 1.5) * amp;
        if (t) c.lineTo(X, Y);
        else c.moveTo(X, Y);
      }
      c.stroke();
    } else {
      c.fillStyle = pal.c(0, 0.85, 0.8, 0.9);
      c.beginPath();
      c.ellipse(q.x, q.y, Math.max(0.6, q.r), Math.max(0.6, q.r) * (q.e ?? 1), 0, 0, TAU);
      c.fill();
    }
  }
  c.restore();
}

/** One level of noise over the dark gradients, so they do not band. */
export function grainPattern(c: Ctx, seed: number): CanvasPattern | null {
  const t = newCanvas(96, 96);
  const tx = ctx2d(t);
  const im = tx.createImageData(96, 96);
  const gr = rng(seed + 99);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = gr() < 0.5 ? 0 : 255;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 3 + gr() * 4;
  }
  tx.putImageData(im, 0, 0);
  return c.createPattern(t, "repeat");
}
