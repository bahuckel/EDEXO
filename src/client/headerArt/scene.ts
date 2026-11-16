/**
 * The header artwork's picture (owner, 2026-11-16: "planet, stars, some plants on planet, where it changes
 * color with the app color", then "make the background rotate with the planet with time, like the planets
 * in the sky rotate … ~10 min with different parts of the sky").
 *
 * A view from the ground. The land stands still: two far ranges, mist, middle hills, and the ground with
 * the plants the app is about, the sample rings round one of them. The sky is one long picture that wraps
 * round with no seam and slides behind the land once in {@link ROTATION_S}, along a rising line as a sky
 * does over an eastern horizon: everything comes up from the bottom edge and climbs to the right. One turn
 * shows the ringed giant and its moon, the star rising out of the far range, two moons, and the thick of
 * the star river. The land's edge light follows the star.
 *
 * Four canvases stacked in the header, so a step is cheap: only the sky is copied to its new place, and the
 * light on the land is redrawn a few times a second while the star is near. The land never repaints.
 */
import { envelope, freeRect, type Layout } from "./layout";
import { TAU, clamp, fbm, fbmP, lerp, palette, rng, sstep, type Palette, type Rgb } from "./maths";
import { PLANT, PLANT_H, type Glint, type PlantKind } from "./plants";

/** One turn of the sky, in seconds (owner, 2026-11-16: 10 minutes was too fast, "30 min instead of 10"). */
export const ROTATION_S = 1800;

type Ctx = CanvasRenderingContext2D;
type Vec3 = [number, number, number];
type Height = (x: number) => number;

function layerCanvas(w: number, h: number, dpr: number): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const cx = cv.getContext("2d")!;
  cx.scale(dpr, dpr);
  return [cv, cx];
}

/* ------------------------------------------------ the land ------------------------------------------------ */

interface Land {
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

function landModel(L: Layout, seed: number): Land {
  const { w, h } = L;
  const { env, cap } = envelope(L);
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
    hFar2: (x) => Math.max(3.5, E(x) * (0.34 + 0.62 * Math.pow(ridged(x + 900, 0.006, s1 + 7), 1.5)) * (0.62 + 0.38 * fbm(x * 0.0022, 9.3, s1 + 9, 2))),
    hFar: (x) => Math.max(3, E(x) * (0.26 + 0.7 * Math.pow(ridged(x, 0.011, s1), 1.8)) * (0.7 + 0.3 * fbm(x * 0.003, 2.3, s1 + 4, 2))),
    hMid: (x) => Math.max(2.5, E(x) * (0.3 + 0.5 * fbm(x * 0.0075, 4.2, s2, 4))),
    hNear: (x) => Math.max(2, E(x) * (0.2 + 0.26 * fbm(x * 0.0048, 8.8, s3, 3)) + 0.8 * fbm(x * 0.09, 2, s3, 2)),
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
function farRange(lm: Land, pal: Palette, fn: Height, seed: number, o: RangeLook): HTMLCanvasElement {
  const W = Math.ceil(lm.w);
  const H = Math.ceil(lm.cap * 1.08) + 4;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
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
function drawBackLand(c: Ctx, lm: Land, pal: Palette, seed: number, rnd: () => number): { f1: HTMLCanvasElement; f2: HTMLCanvasElement } {
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
  if (lm.hasPeak) {
    c.fillStyle = c.strokeStyle = pal.c(0, 0.55, 0.055);
    const kinds: PlantKind[] = ["tussock", "cactoida", "tubus", "frutexa", "shards", "clypeus"];
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

interface Spot {
  x: number;
  k: PlantKind;
  s: number;
}

/** The near ground and the plants as one dark layer, with the places that glow and the plant the rings go round. */
function plantsLayer(lm: Land, pal: Palette, seed: number, rnd: () => number, dpr: number): { pc: HTMLCanvasElement; glints: Glint[]; hero: Spot | null } {
  const { w, h, cap, E, hNear, pk0, pk1, pkC, pkW } = lm;
  const [pc, px] = layerCanvas(w, h, dpr);
  const near = pal.c(0, 0.45, 0.032);
  px.fillStyle = px.strokeStyle = near;
  lm.ridgePath(px, hNear);
  px.fill();
  const glints: Glint[] = [];
  let hero: Spot | null = null;
  if (lm.hasPeak) {
    const order: PlantKind[] = ["tussock", "stratum", "cactoida", "fungoida", "bacterium", "tubus", "aleoida", "brain", "shards", "frutexa", "osseus", "clypeus", "concha", "tussock"];
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = order[i]!;
      order[i] = order[j]!;
      order[j] = t;
    }
    const base = clamp(cap * 0.5, 15, 50);
    const spots: Spot[] = [];
    let x = pk0 + 22 + rnd() * 14;
    for (let i = 0; x < pk1 - 20; i++) {
      const k = order[i % order.length]!;
      const room = E(x) - hNear(x) - 4;
      const s = Math.min(base * (0.5 + rnd() * 0.75), (room / Math.max(0.5, PLANT_H[k])) * 0.92);
      if (s > 7) spots.push({ x, k, s });
      x += base * (0.8 + rnd() * 0.9);
    }
    // The one the sample rings go round: the tallest near the middle.
    const low: PlantKind[] = ["stratum", "bacterium", "concha"];
    hero = spots.filter((p) => Math.abs(p.x - pkC) < pkW * 0.22 && !low.includes(p.k)).sort((a, b) => b.s * PLANT_H[b.k] - a.s * PLANT_H[a.k])[0] ?? null;
    if (hero) hero.s = Math.min(hero.s * 1.25, (E(hero.x) - hNear(hero.x) - 3) / PLANT_H[hero.k]);
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
  }
  return { pc, glints, hero };
}

/** The sample rings round the one in the middle (the app's own mark) and what glows on the plants. */
function drawRingsAndGlints(c: Ctx, lm: Land, pal: Palette, dpr: number, hero: Spot | null, glints: Glint[]): void {
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
function grainPattern(c: Ctx, seed: number): CanvasPattern | null {
  const t = document.createElement("canvas");
  t.width = t.height = 96;
  const tx = t.getContext("2d")!;
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

/* ------------------------------------------------ the sky ------------------------------------------------ */

/** Spare sky round the repeating picture, px. */
const SKY_MARGIN = 8;
const sphereSize = (R: number, dpr: number) => (Math.ceil(R * 2 * dpr) + 2) / dpr;

/** A lit sphere with cloud bands, pixel by pixel; `Ld` is the light's direction (x right, y down, z to the viewer). */
function sphere(R: number, dpr: number, pal: Palette, Ld: Vec3, seed: number, tilt: number, o: { bandF?: number; ringShadow?: number } = {}): HTMLCanvasElement {
  const S = Math.ceil(R * 2 * dpr) + 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const x2 = cv.getContext("2d")!;
  const img = x2.createImageData(S, S);
  const d = img.data;
  const Rp = R * dpr;
  const c0 = S / 2;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const A = pal.raw(0, 0.8, 0.58);
  const B = pal.raw(20, 0.62, 0.3);
  const C = pal.raw(-14, 0.5, 0.74);
  const rim = pal.raw(0, 0.9, 0.72);
  const bandF = o.bandF ?? 5.5;
  for (let py = 0; py < S; py++)
    for (let px = 0; px < S; px++) {
      const nx = (px + 0.5 - c0) / Rp;
      const ny = (py + 0.5 - c0) / Rp;
      const q = nx * nx + ny * ny;
      if (q > 1.02) continue;
      const nz = Math.sqrt(Math.max(0, 1 - q));
      const u = nx * ct + ny * st;
      const v = -nx * st + ny * ct;
      const warp = fbm(u * 2.2 + 9, v * 5 + 3, seed, 3) - 0.5;
      const band = fbm(u * 0.9 + warp * 1.6, v * bandF + warp * 0.8, seed + 5, 4);
      const fine = fbm(u * 3 + warp * 3, v * bandF * 3.4, seed + 9, 2);
      const t = sstep(0.3, 0.7, band);
      const k = sstep(0.62, 0.9, fine) * 0.55;
      const lam = nx * Ld[0] + ny * Ld[1] + nz * Ld[2];
      const lit = sstep(-0.12, 0.55, lam) * (0.35 + 0.65 * Math.max(0, lam));
      const shadowBand = o.ringShadow ? 1 - 0.5 * sstep(0.09, 0.02, Math.abs(v - o.ringShadow)) : 1;
      const shade = (0.05 + lit * 1.25) * (0.45 + 0.55 * Math.pow(nz, 0.45)) * shadowBand;
      const fres = Math.pow(1 - nz, 2.6) * sstep(-0.35, 0.35, lam) * 0.9;
      const i = (py * S + px) * 4;
      d[i] = clamp(lerp(lerp(B[0], A[0], t), C[0], k) * shade + rim[0] * fres, 0, 255);
      d[i + 1] = clamp(lerp(lerp(B[1], A[1], t), C[1], k) * shade + rim[1] * fres, 0, 255);
      d[i + 2] = clamp(lerp(lerp(B[2], A[2], t), C[2], k) * shade + rim[2] * fres, 0, 255);
      d[i + 3] = 255 * sstep(1.0, 1 - 1.6 / Rp, Math.sqrt(q));
    }
  x2.putImageData(img, 0, 0);
  return cv;
}

/** Rings as many thin ellipses cut into short arcs: each arc knows whether it is behind the planet and in its shadow. */
function ringHalf(c: Ctx, cx: number, cy: number, R: number, pal: Palette, Ld: Vec3, seed: number, roll: number, incl: number, front: boolean, alpha: number): void {
  const inner = 1.38;
  const outer = 2.3;
  const si = Math.sin(incl);
  const ci = Math.cos(incl);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const SEG = 72;
  const step = Math.max(0.7, R / 70);
  const lx = Ld[0] * cr + Ld[1] * sr;
  const ly = -Ld[0] * sr + Ld[1] * cr;
  c.lineCap = "butt";
  c.lineWidth = step * 1.25;
  for (let rr = R * inner; rr < R * outer; rr += step) {
    const f = (rr / R - inner) / (outer - inner);
    const dens = fbm(f * 9, 0.5, seed + 31, 3);
    const gap = sstep(0.52, 0.46, Math.abs(f - 0.58) * 6 + 0.42);
    const a0 = clamp((dens - 0.28) * 1.9, 0, 1) * (1 - 0.85 * gap) * sstep(0, 0.08, f) * sstep(1, 0.9, f) * alpha;
    if (a0 < 0.015) continue;
    const col = pal.raw(f * 30 - 10, 0.55, lerp(0.72, 0.5, dens));
    for (let k = 0; k < SEG; k++) {
      const am = ((k + 0.5) / SEG) * TAU;
      const z = Math.sin(am) * ci * rr;
      if (z >= 0 !== front) continue;
      const X = Math.cos(am) * rr;
      const Y = Math.sin(am) * si * rr;
      const t = X * lx + Y * ly + z * Ld[2];
      const perp = Math.hypot(X - t * lx, Y - t * ly, z - t * Ld[2]);
      const lit = t < 0 ? sstep(R * 0.92, R * 1.06, perp) : 1;
      c.strokeStyle = pal.css(col, a0 * (0.1 + 0.9 * lit));
      c.beginPath();
      c.ellipse(cx, cy, rr, rr * si, roll, (k / SEG) * TAU - 0.004, ((k + 1) / SEG) * TAU + 0.004);
      c.stroke();
    }
  }
}

function crossStar(c: Ctx, pal: Palette, x: number, y: number, len: number): void {
  const col = pal.raw(0, 0.35, 0.92);
  c.save();
  c.globalCompositeOperation = "lighter";
  const arms: [number, number][] = [
    [1, 0],
    [0, 1],
  ];
  for (const [dx, dy] of arms) {
    const g = c.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
    g.addColorStop(0, pal.css(col, 0));
    g.addColorStop(0.5, pal.css(col, 0.75));
    g.addColorStop(1, pal.css(col, 0));
    c.strokeStyle = g;
    c.lineWidth = 0.8;
    c.beginPath();
    c.moveTo(x - dx * len, y - dy * len);
    c.lineTo(x + dx * len, y + dy * len);
    c.stroke();
  }
  c.fillStyle = "#fff";
  c.beginPath();
  c.arc(x, y, 1.1, 0, TAU);
  c.fill();
  c.restore();
}

function drawSphere(c: Ctx, cv: HTMLCanvasElement, x: number, y: number, R: number, dpr: number): void {
  c.drawImage(cv, x - R - 1 / dpr, y - R - 1 / dpr, sphereSize(R, dpr), sphereSize(R, dpr));
}

function ringedGiant(c: Ctx, cx: number, cy: number, R: number, dpr: number, pal: Palette, light: (lz: number) => Vec3, seed: number): void {
  const roll = -0.3;
  const incl = 0.3;
  const Ld = light(0.12);
  ringHalf(c, cx, cy, R, pal, Ld, seed, roll, incl, false, 0.85);
  drawSphere(c, sphere(R, dpr, pal, Ld, seed + 3, roll, { ringShadow: 0.16 }), cx, cy, R, dpr);
  ringHalf(c, cx, cy, R, pal, Ld, seed, roll, incl, true, 0.85);
  const mr = Math.max(2.2, R * 0.13);
  drawSphere(c, sphere(mr, dpr, pal, Ld, seed + 8, 0.4, { bandF: 1.2 }), cx - R * 2.9, cy + R * 0.55, mr, dpr);
}

function twinMoons(c: Ctx, cx: number, cy: number, R: number, dpr: number, pal: Palette, light: (lz: number) => Vec3, seed: number): void {
  const Ld = light(-0.25);
  drawSphere(c, sphere(R, dpr, pal, Ld, seed + 3, 0.5, { bandF: 1.4 }), cx, cy, R, dpr);
  const r2 = R * 0.42;
  drawSphere(c, sphere(r2, dpr, pal, Ld, seed + 4, 1.1, { bandF: 1 }), cx - R * 3.3, cy + R * 1.1, r2, dpr);
}

/** The star: its wide glow, its core, and the long flat flare of a lens. */
function sunGlow(c: Ctx, pal: Palette, x: number, y: number, r: number, big: number, fl: number): void {
  c.save();
  c.globalCompositeOperation = "lighter";
  let g = c.createRadialGradient(x, y, 0, x, y, big);
  g.addColorStop(0, pal.c(0, 1, 0.62, 0.5));
  g.addColorStop(0.25, pal.c(0, 1, 0.55, 0.2));
  g.addColorStop(1, pal.c(0, 1, 0.5, 0));
  c.fillStyle = g;
  c.fillRect(x - big, y - big, big * 2, big * 2);
  g = c.createRadialGradient(x, y, 0, x, y, r * 3.2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, pal.c(0, 0.6, 0.9, 0.95));
  g.addColorStop(1, pal.c(0, 1, 0.6, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r * 3.2, 0, TAU);
  c.fill();
  const f = c.createLinearGradient(x - fl, 0, x + fl, 0);
  f.addColorStop(0, pal.c(0, 1, 0.7, 0));
  f.addColorStop(0.5, pal.c(0, 0.8, 0.8, 0.5));
  f.addColorStop(1, pal.c(0, 1, 0.7, 0));
  c.fillStyle = f;
  c.fillRect(x - fl, y - 0.6, fl * 2, 1.2);
  c.restore();
}

interface Sky {
  cv: HTMLCanvasElement;
  /** The picture's size in header pixels: it repeats after P across and Hp down. */
  P: number;
  Hp: number;
  /** How much the sky climbs for each pixel it moves right: one picture height in one picture width. */
  slope: number;
  sun: { x: number; y: number; r: number };
  /** The turn at which the giant is over the free part: where the clock starts. */
  start: number;
  /** Spare picture on every side of the P × Hp that repeats, in header pixels (see `step`). */
  margin: number;
}

/**
 * The long sky picture: about 3.2 header widths and a little taller than the header, wrapping both ways. Kept
 * under 7 M pixels (the wide header at 2× is 9,972 × 568): a smaller scale only softens the stars a little.
 *
 * It carries a margin of the same sky on every side (the far edge's picture again), so a copy placed at a
 * fraction of a pixel never reads past its own edge: without it the joins showed as dark lines (owner, 2026-11-16).
 */
function buildSky(L: Layout, lm: Land, pal: Palette, seed: number, dpr: number): Sky {
  const { w, h } = L;
  const P = Math.round(Math.max(w * 3.2, 2200));
  const Hp = Math.round(h * 1.25) + 24;
  const slope = Hp / P;
  const rnd = rng(seed * 104729 + 5);
  let sd = dpr;
  while (P * Hp * sd * sd > 7e6 && sd > 1) sd -= 0.25;
  const M = SKY_MARGIN;
  const [cv, c] = layerCanvas(P + 2 * M, Hp + 2 * M, sd);
  c.translate(M, M);
  const wrapY = (y: number) => ((y % Hp) + Hp) % Hp;
  // Where each subject must pass: through this point of the header when it is over the free part.
  const fr = freeRect(L, lm.env);
  const tx = lm.hasPeak ? lm.pkC : fr ? fr.x + fr.w * 0.6 : w * 0.7;
  const through = (px: number, X: number, Y: number) => wrapY(Y + (X - px) * slope);
  const sunX = tx - lm.pkW * 0.12;
  const sun = { x: P * 0.1, y: 0, r: clamp(lm.cap * 0.1, 3, 11) };
  sun.y = through(sun.x, sunX, h - (lm.hasPeak ? lm.hFar(sunX) * 0.9 : h * 0.5));
  const gR = clamp(Math.min(h * 0.21, w * 0.07), 11, 62);
  const giant = { x: P * 0.42, y: 0 };
  giant.y = through(giant.x, tx + lm.pkW * 0.12, clamp(h * 0.36, gR * 1.2, h - lm.cap * 0.7));
  const mR = clamp(h * 0.075, 5, 18);
  const moons = { x: P * 0.86, y: 0 };
  moons.y = through(moons.x, tx + lm.pkW * 0.1, clamp(h * 0.32, mR * 2, h - lm.cap * 0.8));
  // The star river: a band that wanders up and down the picture, thickest at one place along it.
  const bandOf = (X: number, Y: number) => {
    let dy = Math.abs(wrapY(Y) - Hp * (0.5 + 0.2 * Math.sin((X / P) * TAU + 1.1)));
    dy = Math.min(dy, Hp - dy);
    const bd = dy / (h * 0.5);
    return Math.exp(-bd * bd * 1.5) * (0.5 + 0.5 * (0.5 + 0.5 * Math.cos((X / P - 0.62) * TAU)));
  };

  // The nebula, at a third of the size: warped noise in the accent and two neighbour hues.
  {
    const q = 3;
    // One cell more than the margin on every side, so the smoothing at the picture's edge has real sky to read.
    const pad = Math.ceil(M / q) + 1;
    const nw = Math.ceil(P / q) + 2 * pad;
    const nh = Math.ceil(Hp / q) + 2 * pad;
    const nc = document.createElement("canvas");
    nc.width = nw;
    nc.height = nh;
    const x2 = nc.getContext("2d")!;
    const img = x2.createImageData(nw, nh);
    const d = img.data;
    const cx = Math.max(4, Math.round(P / (h * 1.1)));
    const cy = Math.max(2, Math.round(Hp / (h * 0.7)));
    const c1 = pal.raw(0, 0.95, 0.48);
    const c2 = pal.raw(-24, 0.85, 0.4);
    const c3 = pal.raw(12, 0.6, 0.66);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const X = (x - pad) * q;
        const Y = (y - pad) * q;
        const u = X / P;
        const v = Y / Hp;
        const wx = ((fbmP(u, v, seed + 40, cx, cy, 3) - 0.5) * 1.5) / cx;
        const wy = ((fbmP(u + 0.37, v + 0.21, seed + 41, cx, cy, 3) - 0.5) * 1.5) / cy;
        const n = fbmP(u + wx, v + wy, seed + 42, cx, cy, 5);
        const dust = fbmP(u + wx * 1.3, v + wy * 1.3, seed + 43, cx * 2, cy * 2, 4);
        const a = sstep(0.36, 0.86, n * (0.55 + 0.75 * bandOf(X, Y))) * (1 - 0.8 * sstep(0.46, 0.72, dust)) * 0.6;
        const m = sstep(0.35, 0.65, fbmP(u, v, seed + 44, Math.max(2, cx >> 1), 1, 2));
        const m2 = sstep(0.55, 0.8, n) * 0.5;
        const i = (y * nw + x) * 4;
        d[i] = lerp(lerp(c1[0], c2[0], m), c3[0], m2);
        d[i + 1] = lerp(lerp(c1[1], c2[1], m), c3[1], m2);
        d[i + 2] = lerp(lerp(c1[2], c2[2], m), c3[2], m2);
        d[i + 3] = clamp(a, 0, 1) * 255;
      }
    x2.putImageData(img, 0, 0);
    c.imageSmoothingQuality = "high";
    c.drawImage(nc, -pad * q, -pad * q, nw * q, nh * q);
  }

  // Anything near an edge is drawn again on the other side, so the picture wraps without a cut.
  const wrapped = (x: number, y: number, pad: number, draw: (x: number, y: number) => void) => {
    const xs = [0, ...(x < pad + M ? [P] : []), ...(x > P - pad - M ? [-P] : [])];
    const ys = [0, ...(y < pad + M ? [Hp] : []), ...(y > Hp - pad - M ? [-Hp] : [])];
    for (const dx of xs) for (const dy of ys) draw(x + dx, y + dy);
  };
  // Stars: many faint, few bright, thicker in the river.
  for (let i = 0, want = Math.round((P * Hp) / 210); i < want; i++) {
    const x = rnd() * P;
    const y = rnd() * Hp;
    const u = rnd();
    const bright = u * u * u * u;
    const tint = rnd();
    if (rnd() > 0.28 + 0.9 * bandOf(x, y)) continue;
    const col: Rgb = tint < 0.62 ? [255, 255, 255] : tint < 0.86 ? pal.raw(0, 0.5, 0.86) : pal.raw(170, 0.45, 0.86);
    const a = 0.1 + bright * 0.9;
    const r = 0.35 + bright;
    wrapped(x, y, 8, (X, Y) => {
      c.fillStyle = pal.css(col, a);
      c.beginPath();
      c.arc(X, Y, r, 0, TAU);
      c.fill();
      if (bright > 0.45) {
        const g = c.createRadialGradient(X, Y, 0, X, Y, r * 5);
        g.addColorStop(0, pal.css(col, 0.32 * bright));
        g.addColorStop(1, pal.css(col, 0));
        c.fillStyle = g;
        c.beginPath();
        c.arc(X, Y, r * 5, 0, TAU);
        c.fill();
      }
    });
  }
  for (let n = 0; n < Math.max(5, Math.round(P / 420)); n++) {
    const len = 5 + rnd() * 7;
    wrapped(rnd() * P, rnd() * Hp, 14, (X, Y) => crossStar(c, pal, X, Y, len));
  }
  // The subjects. The giant and the moons are lit from where the star is in this picture: behind them, lower left.
  const light = (lz: number): Vec3 => {
    const k = Math.sqrt(1 - lz * lz);
    return [-0.96 * k, 0.28 * k, lz];
  };
  wrapped(giant.x, giant.y, gR * 2.6, (X, Y) => ringedGiant(c, X, Y, gR, sd, pal, light, seed));
  wrapped(moons.x, moons.y, mR * 4, (X, Y) => twinMoons(c, X, Y, mR, sd, pal, light, seed));
  const glowR = lm.hasPeak ? clamp(lm.cap * 2.3, 60, 230) : 40;
  wrapped(sun.x, sun.y, glowR, (X, Y) => sunGlow(c, pal, X, Y, sun.r, glowR, lm.hasPeak ? clamp(lm.pkW * 0.2, 40, 150) : 30));
  const start = ((((tx + lm.pkW * 0.12 - giant.x) / P) % 1) + 1) % 1;
  return { cv, P, Hp, slope, sun, start, margin: M };
}

/* ------------------------------------------------ the scene ------------------------------------------------ */

export interface TurningScene {
  /** Show one moment of the turn (0..1). `now` (ms) only spaces out the light's redraws. */
  step(turn: number, now?: number): void;
}

/**
 * Builds every layer once into `box` (four canvases: sky / shade + far land / light / ground + plants).
 * `accentRgb` and `shadeRgb` are "r, g, b" as in `--accent-rgb` and `--shade-top-rgb`.
 */
export function turningScene(box: HTMLElement, L: Layout, accentRgb: string, shadeRgb: string, seed: number, dpr: number): TurningScene {
  const { w, h, taken } = L;
  const pal = palette(accentRgb);
  const rnd = rng(seed * 7919 + 13);
  const lm = landModel(L, seed);
  const { cap, pkW } = lm;
  const sky = buildSky(L, lm, pal, seed, dpr);
  // The light only ever falls on the land: its canvases are that bottom band, not the whole header.
  const hb = Math.min(h, Math.ceil(cap * 1.15) + 8);
  const oy = h - hb;
  const band = (): [HTMLCanvasElement, Ctx] => {
    const [cv, cx] = layerCanvas(w, hb, dpr);
    cx.translate(0, -oy);
    return [cv, cx];
  };
  const [skyCv, sx] = layerCanvas(w, h, dpr);
  const [backCv, bx] = layerCanvas(w, h, dpr);
  const [lightCv, lx] = band();
  const [frontCv, fx] = layerCanvas(w, h, dpr);
  lightCv.style.cssText = `top:auto;bottom:0;height:${hb}px`;
  box.append(skyCv, backCv, lightCv, frontCv);

  // back: the shade behind every block and line of text (the sky stays calm there), then the land behind the plants.
  bx.save();
  bx.shadowColor = bx.fillStyle = `rgba(${shadeRgb},0.9)`;
  bx.shadowBlur = 14 * dpr;
  for (const [l, t, r, b] of taken) bx.fillRect(l - 3, t - 2, r - l + 6, b - t + 4);
  bx.restore();
  const far = drawBackLand(bx, lm, pal, seed, rnd);
  // front: the plants' layer, their marks, the grain.
  const { pc, glints, hero } = plantsLayer(lm, pal, seed, rnd, dpr);
  fx.drawImage(pc, 0, 0, w, h);
  drawRingsAndGlints(fx, lm, pal, dpr, hero, glints);
  fx.save();
  fx.setTransform(1, 0, 0, 1, 0, 0);
  const grain = grainPattern(fx, seed);
  if (grain) {
    fx.fillStyle = grain;
    fx.globalCompositeOperation = "source-atop";
    fx.fillRect(0, 0, frontCv.width, frontCv.height);
  }
  fx.restore();
  // What the light falls on: the far ranges where nothing nearer covers them; the plants' layer in white, sharp and soft.
  const [farMask, mx] = band();
  mx.imageSmoothingQuality = "high";
  mx.drawImage(far.f2, 0, h - far.f2.height);
  mx.drawImage(far.f1, 0, h - far.f1.height);
  mx.globalCompositeOperation = "destination-out";
  lm.ridgePath(mx, lm.hMid);
  mx.fill();
  mx.drawImage(pc, 0, 0, w, h);
  const [edge, ex] = band();
  ex.drawImage(pc, 0, 0, w, h);
  ex.globalCompositeOperation = "source-in";
  ex.fillStyle = "#fff";
  ex.fillRect(0, 0, w, h);
  const [edgeSoft, esx] = band();
  esx.filter = "blur(4px)";
  esx.drawImage(edge, 0, oy - 1.5, w, hb);
  const [tmp, tx] = band();
  /** `src` in the colours of `grad`, drawn on the light layer; `fade` (alpha only) thins it out across the header. */
  const tint = (src: HTMLCanvasElement, grad: CanvasGradient, alpha: number, dx: number, dy: number, fade: CanvasGradient | null) => {
    tx.save();
    tx.globalCompositeOperation = "copy";
    tx.drawImage(src, 0, oy, w, hb);
    tx.globalCompositeOperation = "source-in";
    tx.fillStyle = grad;
    tx.fillRect(0, 0, w, h);
    if (fade) {
      tx.globalCompositeOperation = "destination-in";
      tx.fillStyle = fade;
      tx.fillRect(0, 0, w, h);
    }
    tx.restore();
    lx.save();
    lx.globalAlpha = alpha;
    lx.drawImage(tmp, dx, oy + dy, w, hb);
    lx.restore();
  };

  let lit = { vis: -1, x: 0, at: 0 };
  function light(sun: { x: number; y: number } | null, vis: number): void {
    const px = sun ? sun.x : w * 0.5;
    lx.clearRect(0, 0, w, h);
    if (sun && vis > 0.01) {
      const R = clamp(cap * 2.6, 70, 300);
      const g = lx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, R);
      g.addColorStop(0, pal.c(0, 1, 0.6, 0.4 * vis));
      g.addColorStop(1, pal.c(0, 1, 0.5, 0));
      tint(farMask, g, 1, 0, 0, null);
    }
    // The edge light: faint from the sky always, bright towards the star while it is up.
    const reach = Math.max(260, pkW * 0.85);
    const amb = 0.26;
    const g = lx.createLinearGradient(px - reach, 0, px + reach, 0);
    g.addColorStop(0, pal.c(0, 1, 0.5, amb));
    g.addColorStop(0.5, pal.c(0, lerp(1, 0.95, vis), lerp(0.5, 0.7, vis), lerp(amb, 1, vis)));
    g.addColorStop(1, pal.c(0, 1, 0.5, amb));
    tint(edgeSoft, g, 0.32, 0, 0, null);
    /*
      Left of the star the light comes from the right, and the other way round: each side's copy is pushed towards
      it. The two fade into each other under the star: cut at a line they left a dark seam there (owner, 2026-11-16).
    */
    const sides: [number, number, number][] = [
      [1.1, 1, 0],
      [-1.1, 0, 1],
    ];
    for (const [dx, a0, a1] of sides) {
      const fade = lx.createLinearGradient(px - 60, 0, px + 60, 0);
      fade.addColorStop(0, `rgba(0,0,0,${a0})`);
      fade.addColorStop(1, `rgba(0,0,0,${a1})`);
      tint(edge, g, 1, dx, -0.9, fade);
    }
  }

  function step(turn: number, now = performance.now()): void {
    const s = ((((turn + sky.start) % 1) + 1) % 1) * sky.P;
    const y0 = -((s * sky.slope) % sky.Hp);
    sx.clearRect(0, 0, w, h);
    sx.imageSmoothingQuality = "high";
    /*
      Up to four copies of the picture meet in the header. Each is drawn only in its own quarter, and the quarters
      meet on whole device pixels, so no pixel is drawn twice (the sky is see-through: twice would be brighter) and
      none is left half-drawn. The picture itself sits at a fraction of a pixel and reads into its margin.
    */
    const M = sky.margin;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const jx = clamp(snap(s), 0, w);
    const jy = clamp(snap(y0 + sky.Hp), 0, h);
    let sun: { x: number; y: number } | null = null;
    for (const ox of [s - sky.P, s])
      for (const yy of [y0, y0 + sky.Hp]) {
        const x0 = ox < s ? 0 : jx;
        const x1 = ox < s ? jx : w;
        const t0 = yy < y0 + sky.Hp ? 0 : jy;
        const t1 = yy < y0 + sky.Hp ? jy : h;
        if (x1 > x0 && t1 > t0) {
          sx.save();
          sx.beginPath();
          sx.rect(x0, t0, x1 - x0, t1 - t0);
          sx.clip();
          sx.drawImage(sky.cv, ox - M, yy - M, sky.P + 2 * M, sky.Hp + 2 * M);
          sx.restore();
        }
        const X = sky.sun.x + ox;
        const Y = sky.sun.y + yy;
        if (X > -320 && X < w + 320 && Y > -120 && Y < h + 90) sun = { x: X, y: Y };
      }
    // The land's light follows the star: redrawn at most four times a second, and only while it changes.
    const vis = sun ? sstep(h + 40, h - cap * 0.5, sun.y) * sstep(-320, -40, sun.x) * sstep(w + 320, w + 40, sun.x) : 0;
    const sunAt = sun ? sun.x : 0;
    const moved = Math.abs(vis - lit.vis) > 0.004 || Math.abs(sunAt - lit.x) > 0.75;
    if (lit.vis < 0 || ((vis > 0.01 || lit.vis > 0.01) && moved && (now - lit.at > 250 || now < lit.at))) {
      light(sun, vis);
      lit = { vis, x: sunAt, at: now };
    }
  }
  return { step };
}
