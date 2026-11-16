/**
 * The header artwork's sky (owner, 2026-11-16: "make the background rotate with the planet with time, like the
 * planets in the sky rotate … with different parts of the sky"): one long picture that wraps round with no seam
 * and slides behind the land once in {@link ROTATION_S}, along a rising line as a sky does over an eastern
 * horizon — everything comes up from the bottom edge and climbs to the right. One turn shows the ringed giant and
 * its moon, the star rising, two moons, and the thick of the star river.
 *
 * Two halves: where things are (`skyGeometry`, `skyPlace`, `subjectOnScreen`: plain numbers, tested), and the
 * painting (`paintSky`), which needs no page and so runs in a worker (skyWorker.ts). The sky depends on the
 * header's size, the scheme and the seed only, never on the header's blocks: a card that moves rebuilds the land,
 * not the sky.
 */
import { ctx2d, layerCanvas, newCanvas, type AnyCanvas, type Ctx } from "./canvas";
import { TAU, clamp, fbm, fbmP, landCap, lerp, palette, rng, sstep, type Palette, type Rgb } from "./maths";

/** One turn of the sky, in seconds (owner, 2026-11-16: 10 minutes was too fast, "30 min instead of 10"). */
export const ROTATION_S = 1800;
/** Spare sky round the repeating picture, px: a copy placed at a fraction of a pixel reads into it, not past its edge. */
const SKY_MARGIN = 8;

type Vec3 = [number, number, number];

export interface SkySubject {
  /** Where it is in the picture. */
  x: number;
  y: number;
  /** The point of the header it passes through. */
  aim: [number, number];
}

export interface SkyGeometry {
  w: number;
  h: number;
  /** The picture repeats after P across and Hp down, in header pixels. */
  P: number;
  Hp: number;
  /** How much the sky climbs for each pixel it moves right: one picture height in one picture width. */
  slope: number;
  margin: number;
  /** Device pixels per header pixel the picture is painted at (never more than 7 M pixels in all). */
  scale: number;
  sun: SkySubject & { r: number; glow: number; flare: number };
  giant: SkySubject & { R: number };
  moons: SkySubject & { R: number };
  /** The turn at which the giant is at its aim: where the clock starts. */
  start: number;
}

export function skyGeometry(w: number, h: number, dpr: number): SkyGeometry {
  const P = Math.round(Math.max(w * 3.2, 2200));
  const Hp = Math.round(h * 1.25) + 24;
  const slope = Hp / P;
  const cap = landCap(h);
  let scale = dpr;
  while (P * Hp * scale * scale > 7e6 && scale > 1) scale -= 0.25;
  const wrapY = (y: number) => ((y % Hp) + Hp) % Hp;
  // A subject at picture x that must cross the header at (X, Y): the picture's y that puts it there.
  const at = (px: number, aim: [number, number]): SkySubject => ({ x: px, y: wrapY(aim[1] + (aim[0] - px) * slope), aim });
  const gR = clamp(Math.min(h * 0.21, w * 0.07), 11, 62);
  const mR = clamp(h * 0.075, 5, 18);
  const giant = { ...at(P * 0.42, [w * 0.76, clamp(h * 0.36, gR * 1.2, h - cap * 0.7)]), R: gR };
  return {
    w,
    h,
    P,
    Hp,
    slope,
    margin: SKY_MARGIN,
    scale,
    // The star comes up through the far range: half-way up the land at two thirds of the header.
    sun: { ...at(P * 0.1, [w * 0.66, h - cap * 0.5]), r: clamp(cap * 0.1, 3, 11), glow: clamp(cap * 2.3, 60, 230), flare: clamp(w * 0.06, 40, 150) },
    giant,
    moons: { ...at(P * 0.86, [w * 0.74, clamp(h * 0.32, mR * 2, h - cap * 0.8)]), R: mR },
    start: ((((giant.aim[0] - giant.x) / P) % 1) + 1) % 1,
  };
}

/** Where the picture sits at `turn` (0..1): its copy with its left edge at `s`, its top at `y0` (and one more above-left of it). */
export function skyPlace(g: SkyGeometry, turn: number): { s: number; y0: number } {
  const s = ((((turn + g.start) % 1) + 1) % 1) * g.P;
  return { s, y0: -((s * g.slope) % g.Hp) };
}

/** Every place a point of the picture shows at `turn`: one for each of the four copies that can meet in the header. */
export function subjectOnScreen(g: SkyGeometry, p: { x: number; y: number }, turn: number): { x: number; y: number }[] {
  const { s, y0 } = skyPlace(g, turn);
  const out: { x: number; y: number }[] = [];
  for (const ox of [s - g.P, s]) for (const oy of [y0, y0 + g.Hp]) out.push({ x: p.x + ox, y: p.y + oy });
  return out;
}

/* ------------------------------------------------ painting ------------------------------------------------ */

const sphereSize = (R: number, dpr: number) => (Math.ceil(R * 2 * dpr) + 2) / dpr;

/** A lit sphere with cloud bands, pixel by pixel; `Ld` is the light's direction (x right, y down, z to the viewer). */
function sphere(R: number, dpr: number, pal: Palette, Ld: Vec3, seed: number, tilt: number, o: { bandF?: number; ringShadow?: number } = {}): AnyCanvas {
  const S = Math.ceil(R * 2 * dpr) + 2;
  const cv = newCanvas(S, S);
  const x2 = ctx2d(cv);
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

function drawSphere(c: Ctx, cv: AnyCanvas, x: number, y: number, R: number, dpr: number): void {
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

/**
 * Paints the long sky picture: the nebula, the stars and the subjects, with a margin of the same sky on every
 * side (the far edge's picture again). `calm` is the stars alone, thinner (Options › Look › Header picture).
 * Needs no page: this is what the worker runs.
 */
export function paintSky(g: SkyGeometry, accentRgb: string, seed: number, calm: boolean): AnyCanvas {
  const { h, P, Hp, margin: M, scale: sd } = g;
  const pal = palette(accentRgb);
  const rnd = rng(seed * 104729 + 5);
  const [cv, c] = layerCanvas(P + 2 * M, Hp + 2 * M, sd);
  c.translate(M, M);
  const wrapY = (y: number) => ((y % Hp) + Hp) % Hp;
  // The star river: a band that wanders up and down the picture, thickest at one place along it.
  const bandOf = (X: number, Y: number) => {
    let dy = Math.abs(wrapY(Y) - Hp * (0.5 + 0.2 * Math.sin((X / P) * TAU + 1.1)));
    dy = Math.min(dy, Hp - dy);
    const bd = dy / (h * 0.5);
    return Math.exp(-bd * bd * 1.5) * (0.5 + 0.5 * (0.5 + 0.5 * Math.cos((X / P - 0.62) * TAU)));
  };

  // The nebula, at a third of the size: warped noise in the accent and two neighbour hues.
  if (!calm) {
    const q = 3;
    // One cell more than the margin on every side, so the smoothing at the picture's edge has real sky to read.
    const pad = Math.ceil(M / q) + 1;
    const nw = Math.ceil(P / q) + 2 * pad;
    const nh = Math.ceil(Hp / q) + 2 * pad;
    const nc = newCanvas(nw, nh);
    const x2 = ctx2d(nc);
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
  for (let i = 0, want = Math.round((P * Hp) / (calm ? 420 : 210)); i < want; i++) {
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
        const gl = c.createRadialGradient(X, Y, 0, X, Y, r * 5);
        gl.addColorStop(0, pal.css(col, 0.32 * bright));
        gl.addColorStop(1, pal.css(col, 0));
        c.fillStyle = gl;
        c.beginPath();
        c.arc(X, Y, r * 5, 0, TAU);
        c.fill();
      }
    });
  }
  if (calm) return cv;
  for (let n = 0; n < Math.max(5, Math.round(P / 420)); n++) {
    const len = 5 + rnd() * 7;
    wrapped(rnd() * P, rnd() * Hp, 14, (X, Y) => crossStar(c, pal, X, Y, len));
  }
  // The subjects. The giant and the moons are lit from where the star is in this picture: behind them, lower left.
  const light = (lz: number): Vec3 => {
    const k = Math.sqrt(1 - lz * lz);
    return [-0.96 * k, 0.28 * k, lz];
  };
  wrapped(g.giant.x, g.giant.y, g.giant.R * 2.6, (X, Y) => ringedGiant(c, X, Y, g.giant.R, sd, pal, light, seed));
  wrapped(g.moons.x, g.moons.y, g.moons.R * 4, (X, Y) => twinMoons(c, X, Y, g.moons.R, sd, pal, light, seed));
  wrapped(g.sun.x, g.sun.y, g.sun.glow, (X, Y) => sunGlow(c, pal, X, Y, g.sun.r, g.sun.glow, g.sun.flare));
  return cv;
}
