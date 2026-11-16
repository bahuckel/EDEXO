/**
 * The header artwork's picture (owner, 2026-11-16: "planet, stars, some plants on planet, where it changes
 * color with the app color", then "make the background rotate with the planet with time").
 *
 * A view from the ground: the land (land.ts) stands still under a sky that turns (sky.ts). Four canvases
 * stacked in the header, so a step is cheap: only the sky is copied to its new place, and the light on the land
 * is redrawn a few times a second while the star is near. The land never repaints.
 *   sky    the turning picture, as much of it as the header shows
 *   back   the shade behind the content (so the sky stays calm there), then the far ranges, mist, middle hills
 *   light  the star's light on the far ranges and along the edges of the ground and the plants
 *   front  the ground and the plants, their glow and the sample rings
 * The sky picture is handed in (`setSky`): it is painted off the page and can arrive after the land.
 */
import type { AnyCanvas, Ctx } from "./canvas";
import { drawBackLand, drawRingsAndGlints, grainPattern, landModel, plantsLayer, type LandStyle } from "./land";
import type { Layout } from "./layout";
import { clamp, lerp, palette, rng, sstep } from "./maths";
import type { PlantKind } from "./plants";
import { skyPlace, type SkyGeometry } from "./sky";

export interface SceneLook {
  /** "r, g, b" as in `--accent-rgb` and `--shade-top-rgb`. */
  accent: string;
  shade: string;
  /** The skyline: the system's. */
  seed: number;
  /** The plants' line-up: the body's. */
  plantSeed: number;
  dpr: number;
  style: LandStyle;
  /** Which plants stand on the ground; none for a body without biology. */
  plants: readonly PlantKind[];
  /** The calm picture: a low line of ground, no ranges, no plants. */
  calm: boolean;
}

export interface TurningScene {
  /** The sky picture for this header, with where things are in it. */
  setSky(image: CanvasImageSource, geometry: SkyGeometry): void;
  /** Show one moment of the turn (0..1). `now` (ms) only spaces out the light's redraws. */
  step(turn: number, now?: number): void;
}

function pageLayer(w: number, h: number, dpr: number): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  const cx = cv.getContext("2d")!;
  cx.scale(dpr, dpr);
  return [cv, cx];
}

/** Builds the land's layers into `box`. */
export function turningScene(box: HTMLElement, L: Layout, look: SceneLook): TurningScene {
  const { w, h, taken } = L;
  const { dpr, seed } = look;
  const pal = palette(look.accent);
  const rnd = rng(look.plantSeed * 7919 + 13);
  const lm = landModel(L, seed, look.style, look.calm);
  const { cap, pkW } = lm;
  // The light only ever falls on the land: its canvases are that bottom band, not the whole header.
  const hb = Math.min(h, Math.ceil(cap * 1.15) + 8);
  const oy = h - hb;
  const band = (): [HTMLCanvasElement, Ctx] => {
    const [cv, cx] = pageLayer(w, hb, dpr);
    cx.translate(0, -oy);
    return [cv, cx];
  };
  const [skyCv, sx] = pageLayer(w, h, dpr);
  const [backCv, bx] = pageLayer(w, h, dpr);
  const [lightCv, lx] = band();
  const [frontCv, fx] = pageLayer(w, h, dpr);
  lightCv.style.cssText = `top:auto;bottom:0;height:${hb}px`;
  box.append(skyCv, backCv, lightCv, frontCv);

  // back: the shade behind every block and line of text (the sky stays calm there), then the land behind the plants.
  const shadeContent = (alpha: number) => {
    bx.save();
    bx.shadowColor = bx.fillStyle = `rgba(${look.shade},${alpha})`;
    // A wide soft edge: with 14 px the shade showed as a box against a bright patch of sky (seen on the phone).
    bx.shadowBlur = 26 * dpr;
    for (const [l, t, r, b] of taken) bx.fillRect(l - 6, t - 4, r - l + 12, b - t + 8);
    bx.restore();
  };
  shadeContent(0.94);
  const far = look.calm ? null : drawBackLand(bx, lm, pal, seed, rnd, look.plants);
  // And over the land's mist, which lies across the whole bottom of the header: measured, it took a quarter of the
  // contrast from the bare text there (the commander line). The land itself is already a thin line under content.
  if (far) shadeContent(0.85);
  // front: the plants' layer, their marks, the grain.
  const { pc, glints, hero } = plantsLayer(lm, pal, look.plantSeed, rnd, dpr, look.calm ? [] : look.plants);
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
  if (far) {
    mx.imageSmoothingQuality = "high";
    mx.drawImage(far.f2, 0, h - far.f2.height);
    mx.drawImage(far.f1, 0, h - far.f1.height);
    mx.globalCompositeOperation = "destination-out";
    lm.ridgePath(mx, lm.hMid);
    mx.fill();
    mx.drawImage(pc, 0, 0, w, h);
  }
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
  const tint = (src: AnyCanvas, grad: CanvasGradient, alpha: number, dx: number, dy: number, fade: CanvasGradient | null) => {
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
    if (far && sun && vis > 0.01) {
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

  let sky: { image: CanvasImageSource; g: SkyGeometry } | null = null;
  let lastTurn = 0;

  function step(turn: number, now = performance.now()): void {
    lastTurn = turn;
    let sunAt: { x: number; y: number } | null = null;
    sx.clearRect(0, 0, w, h);
    if (sky) {
      const g = sky.g;
      const { s, y0 } = skyPlace(g, turn);
      sx.imageSmoothingQuality = "high";
      /*
        Up to four copies of the picture meet in the header. Each is drawn only in its own quarter, and the quarters
        meet on whole device pixels, so no pixel is drawn twice (the sky is see-through: twice would be brighter) and
        none is left half-drawn: at a fraction of a pixel the join showed as a dark line (owner, 2026-11-16). The
        picture itself sits at a fraction of a pixel and reads into its margin.
      */
      const M = g.margin;
      const snap = (v: number) => Math.round(v * dpr) / dpr;
      const jx = clamp(snap(s), 0, w);
      const jy = clamp(snap(y0 + g.Hp), 0, h);
      for (const ox of [s - g.P, s])
        for (const yy of [y0, y0 + g.Hp]) {
          const x0 = ox < s ? 0 : jx;
          const x1 = ox < s ? jx : w;
          const t0 = yy < y0 + g.Hp ? 0 : jy;
          const t1 = yy < y0 + g.Hp ? jy : h;
          if (x1 > x0 && t1 > t0) {
            sx.save();
            sx.beginPath();
            sx.rect(x0, t0, x1 - x0, t1 - t0);
            sx.clip();
            sx.drawImage(sky.image, ox - M, yy - M, g.P + 2 * M, g.Hp + 2 * M);
            sx.restore();
          }
          const X = g.sun.x + ox;
          const Y = g.sun.y + yy;
          if (!look.calm && X > -320 && X < w + 320 && Y > -120 && Y < h + 90) sunAt = { x: X, y: Y };
        }
    }
    // The land's light follows the star: redrawn at most four times a second, and only while it changes.
    const sun = sunAt as { x: number; y: number } | null;
    const vis = sun ? sstep(h + 40, h - cap * 0.5, sun.y) * sstep(-320, -40, sun.x) * sstep(w + 320, w + 40, sun.x) : 0;
    const sunX = sun ? sun.x : 0;
    const moved = Math.abs(vis - lit.vis) > 0.004 || Math.abs(sunX - lit.x) > 0.75;
    if (lit.vis < 0 || ((vis > 0.01 || lit.vis > 0.01) && moved && (now - lit.at > 250 || now < lit.at))) {
      light(sun, vis);
      lit = { vis, x: sunX, at: now };
    }
  }

  return {
    step,
    setSky(image, geometry) {
      sky = { image, g: geometry };
      lit.vis = -1;
      step(lastTurn);
    },
  };
}
