/**
 * The galaxy map's Milky Way as clouds in 3D, made from the game's picture of the galaxy (owner, 2026-11-12: bring the
 * picture back, "simulate 3D clouds based on brightness (brighter = more clouds)"). Soft sprites fall where the
 * picture is bright and dark ones where its dust lanes are, each lifted off the plane by the disc's thickness there.
 *
 * The drawn galaxy these sprites were first made for (1.2.12 to 61e6d052) is archived; docs/archive/
 * drawn-galaxy-12112026/README.md says how to bring it back.
 */

export interface CloudFrame {
  width: number;
  height: number;
  /** Where Sagittarius A* falls in the image, in pixels. */
  coreX: number;
  coreY: number;
  /** Light years per pixel. */
  lyPerPx: number;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const SEED = 7;
/** The bar's angle in the plane, radians from +x towards +z. */
const BAR_ANGLE = 1.05;

// ------------------------------------------------------------------ the clouds in 3D

/** Floats per sprite in galaxyCloudSprites' output. */
export const CLOUD_SPRITE_STRIDE = 9;

/** Deterministic random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal number from two uniform ones. */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/**
 * How far the light spreads above and below the plane at this radius, ly (one standard deviation):
 * the bulge and bar stand thick, the disc is thin, and the edge flares.
 */
function discThickness(dx: number, dz: number, r: number): number {
  const u = dx * Math.cos(BAR_ANGLE) + dz * Math.sin(BAR_ANGLE);
  const v = -dx * Math.sin(BAR_ANGLE) + dz * Math.cos(BAR_ANGLE);
  const bar = Math.exp(-((u / 8_000) ** 2 + (v / 3_000) ** 2));
  return 220 + 4_200 * Math.exp(-((r / 4_200) ** 2)) + 1_300 * bar + 450 * smooth(28_000, 56_000, r);
}

/**
 * The galaxy as clouds in 3D (owner, 2026-10-04: "the whole idea was to make the PNG a 3D cloud"):
 * soft sprites placed where the picture is bright, and dark ones where its dust lanes are, each lifted
 * off the plane by the disc's thickness there. Their brightness is set so that, seen from straight
 * above, they add up to the picture; from any other angle the bulge stands up, the arms have depth and
 * the dust hangs in front of the light behind it.
 *
 * Out: `emission` then `dust` sprites, CLOUD_SPRITE_STRIDE floats each — image x and y in pixels (the
 * frame's), height above the plane in ly, diameter in ly, r, g, b (emission: light to add; dust: the
 * dust's colour), strength (emission: 1; dust: opacity), and a random seed for the sprite's shape.
 */
export function galaxyCloudSprites(
  frame: CloudFrame,
  clear: Uint8ClampedArray,
  dust: Float32Array,
  counts: { emission: number; dust: number },
  seed = SEED,
): Float32Array {
  const { width, height, coreX, coreY, lyPerPx } = frame;
  const n = width * height;
  const out = new Float32Array((counts.emission + counts.dust) * CLOUD_SPRITE_STRIDE);
  const r = rng(seed * 7919 + 1);

  // Where each kind goes: as often as the picture is bright (or dusty) there.
  const pick = (weight: (i: number) => number) => {
    const cdf = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += weight(i);
      cdf[i] = sum;
    }
    return {
      sum,
      at(u: number): number {
        let lo = 0;
        let hi = n - 1;
        const t = u * sum;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cdf[mid]! < t) lo = mid + 1;
          else hi = mid;
        }
        return lo;
      },
    };
  };
  const lum = (i: number) => (clear[i * 4]! + clear[i * 4 + 1]! + clear[i * 4 + 2]!) / (3 * 255);

  // Little dust over the bulge: in 3D it would hang in front of all of it.
  const near = (i: number) => smooth(5_000, 9_000, Math.hypot((i % width) - coreX, Math.floor(i / width) - coreY) * lyPerPx);

  let o = 0;
  const place = (count: number, weight: (i: number) => number, kind: "emission" | "dust") => {
    if (count <= 0) return;
    const cdf = pick(weight);
    if (cdf.sum <= 0) return;
    for (let k = 0; k < count; k++) {
      // Stratified: one sprite per equal share of the weight, so the light is spread evenly, not in clumps.
      const i = cdf.at((k + r()) / count);
      const px = (i % width) + r();
      const py = Math.floor(i / width) + r();
      const dx = (px - coreX) * lyPerPx;
      const dz = -(py - coreY) * lyPerPx;
      const rad = Math.hypot(dx, dz);
      const h = discThickness(dx, dz, rad);
      let size: number;
      let y: number;
      if (kind === "emission") {
        // Where the light is sparse the sprites are few: make them wide and soft there, not grains.
        const sparse = Math.min(2.6, Math.max(0.75, Math.pow(0.25 / Math.max(0.02, lum(i)), 0.45)));
        // Wide and soft: the picture on the plane carries the detail, the clouds the volume (owner,
        // 2026-10-04: "still blotchy").
        size = (950 + 1_700 * r()) * sparse * (1 + 0.5 * smooth(18_000, 50_000, rad)) + 3_200 * Math.exp(-((rad / 3_000) ** 2));
        y = gauss(r) * h;
      } else {
        size = (800 + 1_300 * r()) * (1 + 0.4 * smooth(18_000, 45_000, rad));
        y = gauss(r) * h * 0.55;
      }
      // The sprite's footprint on the picture, in pixels: its falloff is exp(-8 (d / size)^2).
      const area = (Math.PI / 8) * (size / lyPerPx) ** 2;
      const base = o * CLOUD_SPRITE_STRIDE;
      out[base] = px;
      out[base + 1] = py;
      out[base + 2] = y;
      out[base + 3] = size;
      if (kind === "emission") {
        // Sprites fall as often as the light, so each carries the colour and an equal share of it.
        // Sprites fall as often as weight(i); each carries the light that leaves for it.
        const L = Math.max(1e-4, lum(i));
        const share = ((cdf.sum / count / area) * L) / Math.max(1e-6, weight(i));
        out[base + 4] = (clear[i * 4]! / 255 / L) * share;
        out[base + 5] = (clear[i * 4 + 1]! / 255 / L) * share;
        out[base + 6] = (clear[i * 4 + 2]! / 255 / L) * share;
        out[base + 7] = 1;
      } else {
        // Thin dust: n sprites of opacity a dim by about n·a·footprint, which is what the lane did.
        out[base + 4] = 0.11;
        out[base + 5] = 0.065;
        out[base + 6] = 0.035;
        out[base + 7] = Math.min(0.9, ((cdf.sum / count / area) * dust[i]! * near(i)) / Math.max(1e-6, weight(i)) * 1.6);
      }
      out[base + 8] = r();
      o++;
    }
  };
  place(counts.emission, (i) => lum(i) ** 1.3, "emission");
  place(counts.dust, (i) => dust[i]! ** 1.5 * near(i), "dust");
  return o * CLOUD_SPRITE_STRIDE === out.length ? out : out.slice(0, o * CLOUD_SPRITE_STRIDE);
}

/**
 * How much dust dims each pixel of a picture (0-0.7), for galaxyCloudSprites: a lit pixel darker than its
 * neighbourhood is a dust lane, so the 3D clouds get dark sprites there.
 */
export function pictureDust(frame: CloudFrame, rgba: Uint8ClampedArray, radiusPx = 6): Float32Array {
  const { width, height } = frame;
  const n = width * height;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) lum[i] = (rgba[i * 4]! + rgba[i * 4 + 1]! + rgba[i * 4 + 2]!) / (3 * 255);
  // The neighbourhood: a box blur, rows then columns.
  const blur = (from: Float32Array, step: number, lines: number, len: number, stride: number) => {
    const to = new Float32Array(n);
    for (let a = 0; a < lines; a++) {
      const base = a * stride;
      let sum = 0;
      let count = 0;
      for (let k = 0; k < Math.min(radiusPx, len); k++) {
        sum += from[base + k * step]!;
        count++;
      }
      for (let k = 0; k < len; k++) {
        const add = k + radiusPx;
        const drop = k - radiusPx - 1;
        if (add < len) {
          sum += from[base + add * step]!;
          count++;
        }
        if (drop >= 0) {
          sum -= from[base + drop * step]!;
          count--;
        }
        to[base + k * step] = sum / count;
      }
    }
    return to;
  };
  const around = blur(blur(lum, 1, height, width, width), width, width, height, 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const near = around[i]!;
    // A lane dims light that is there: black just past the disc's edge is not dust.
    if (near < 0.05 || lum[i]! < 0.02) continue;
    out[i] = Math.min(0.7, Math.max(0, ((near - lum[i]!) / near) * 0.9));
  }
  return out;
}
