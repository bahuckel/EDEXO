/**
 * The screen readers on a recoloured HUD (owner 2026-11-06: a commander's custom HUD colour was not read). Each of
 * the owner's labelled F10 shots is recoloured with sample GUIColour matrices (shared/hudColourMatrix.ts, as the game
 * does it), then read as it is and brought back with the inverse matrix, beside the app's verdict for the matrix
 * (hudColourSupport: only "undo" matrices are read in the app). --hud-only recolours only the HUD's orange / yellow pixels, as the
 * game does (the planet and the stars keep their colours); without it the whole frame.
 *
 *   npx tsx scripts/hud-colour-bench.ts [--every N] [--hud-only]
 *
 * Labels: docs/hud-distance-labels-05112026.txt (target distance) and docs/hud-pitch-labels-06112026.txt (pitch),
 * bare names in Pictures\Frontier Developments\Elite Dangerous. Nothing is written.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { distanceArea, readTargetDistance } from "../src/shared/hudTargetDistance.js";
import { HUD_DISTANCE_GLYPHS } from "../src/shared/hudDistanceGlyphs.js";
import { readHudPitch } from "../src/shared/hudPitchReader.js";
import { HUD_PITCH_GLYPHS } from "../src/shared/hudPitchGlyphs.js";
import { applyHudMatrix, hudColourSupport, invertHudMatrix, recolourRgba, type HudColourMatrix } from "../src/shared/hudColourMatrix.js";

/** Sample HUD colours: rows MatrixRed, MatrixGreen, MatrixBlue. */
const PRESETS: Record<string, HudColourMatrix> = {
  default: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  blue: [
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
  ],
  green: [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  purple: [
    [0.6, 0, 1],
    [0, 0.3, 0],
    [0, 0, 1],
  ],
  cyan: [
    [0, 0.7, 1],
    [0.2, 0.6, 0],
    [0, 0, 1],
  ],
  blue2: [
    [0, 0.47, 1],
    [0, 0.37, 0],
    [1, 0, 0],
  ],
  white: [
    [1, 1, 1],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

const DIR = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");
const every = Number(process.argv[process.argv.indexOf("--every") + 1]) || 1;
const hudOnly = process.argv.includes("--hud-only");

/** The game's recolouring: every pixel, or (--hud-only) the HUD's orange / yellow ones (and their glow). */
function recolourAsGame(px: Uint8Array, m: HudColourMatrix): void {
  if (!hudOnly) return recolourRgba(px, m);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    if (Math.min(r, g) - b < 40 || r < 120) continue;
    const [nr, ng, nb] = applyHudMatrix(m, r, g, b);
    px[i] = Math.min(255, Math.max(0, nr));
    px[i + 1] = Math.min(255, Math.max(0, ng));
    px[i + 2] = Math.min(255, Math.max(0, nb));
  }
}

function bmp(file: string): { data: Uint8Array; w: number; h: number } {
  const b = readFileSync(file);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h0 = b.readInt32LE(22);
  const by = b.readUInt16LE(28) / 8;
  const h = Math.abs(h0);
  const stride = Math.ceil((w * by) / 4) * 4;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = h0 > 0 ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const i = off + sy * stride + x * by;
      const o = (y * w + x) * 4;
      out[o] = b[i + 2]!;
      out[o + 1] = b[i + 1]!;
      out[o + 2] = b[i]!;
      out[o + 3] = 255;
    }
  }
  return { data: out, w, h };
}

function crop(img: { data: Uint8Array; w: number }, x: number, y: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.w + x) * 4, ((y + r) * img.w + x + w) * 4), r * w * 4);
  return out;
}

const labels = (file: string) =>
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .filter((_, i) => i % every === 0)
    .map((l) => ({ name: l.slice(0, l.lastIndexOf("=")).trim(), text: l.slice(l.lastIndexOf("=") + 1).trim() }));

type Tally = { right: number; unsure: number; wrong: number };
const tally = () => ({ raw: { right: 0, unsure: 0, wrong: 0 } as Tally, back: { right: 0, unsure: 0, wrong: 0 } as Tally });
const score = (t: Tally, got: string | null, truth: string) => (got == null ? t.unsure++ : got === truth ? t.right++ : t.wrong++);

for (const [what, file] of [
  ["distance", "docs/hud-distance-labels-05112026.txt"],
  ["pitch", "docs/hud-pitch-labels-06112026.txt"],
] as const) {
  const res = Object.fromEntries(Object.keys(PRESETS).map((k) => [k, tally()]));
  const list = labels(file);
  for (const { name, text } of list) {
    const img = bmp(join(DIR, name));
    const a =
      what === "distance"
        ? distanceArea(img.w, img.h)
        : { x: Math.round(img.w * 0.3), y: Math.round(img.h * 0.3), w: Math.round(img.w * 0.4), h: Math.round(img.h * 0.4) };
    const base = crop(img, a.x, a.y, a.w, a.h);
    for (const [preset, m] of Object.entries(PRESETS)) {
      const read = (px: Uint8Array): string | null => {
        if (what === "distance") return readTargetDistance(px, a.w, a.h, HUD_DISTANCE_GLYPHS, img.h)?.text ?? null;
        const r = readHudPitch(px, a.w, a.h, HUD_PITCH_GLYPHS, { w: img.w, h: img.h });
        return r ? String(r.boxDeg) : null;
      };
      const shown = base.slice();
      recolourAsGame(shown, m);
      score(res[preset]!.raw, read(shown), text);
      const inv = invertHudMatrix(m);
      if (inv) {
        recolourRgba(shown, inv);
        score(res[preset]!.back, read(shown), text);
      } else res[preset]!.back.unsure++;
    }
  }
  console.log(`\n${what}: ${list.length} shots (right / not sure / wrong)${hudOnly ? ", HUD pixels recoloured only" : ""}`);
  for (const [preset, t] of Object.entries(res))
    console.log(
      `  ${preset.padEnd(8)} as shown ${t.raw.right} / ${t.raw.unsure} / ${t.raw.wrong}   inverse ${t.back.right} / ${t.back.unsure} / ${t.back.wrong}   app: ${hudColourSupport(PRESETS[preset])}`,
    );
}
