/**
 * One labelled F10 shot through the pitch reader, every step shown: the app's own read (no hint, as on a recoloured HUD
 * whose mod settings were not found), each framed pair the any-colour path tries with its colours and per-box digits,
 * and crops of the boxes for a look by eye.
 *
 *   npx tsx scripts/probe-pitch-shot.ts <image> [<out folder>]
 *
 * Bare names are looked for in Pictures\Frontier Developments\Elite Dangerous. Nothing is written but the crops.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  glyphVector,
  GLYPH_H,
  GLYPH_W,
  matchGlyph,
  pitchPairsAnyColour,
  readHudPitchAnyColour,
  type PitchBox,
} from "../src/shared/hudPitchReader.js";
import { HUD_PITCH_GLYPHS } from "../src/shared/hudPitchGlyphs.js";
import { HUD_PITCH_GLYPHS_ANY } from "../src/shared/hudPitchGlyphsAny.js";

const [name, outDir = "build-artifacts/pitch-probe"] = process.argv.slice(2);
if (!name) {
  console.error("usage: npx tsx scripts/probe-pitch-shot.ts <image> [<out folder>]");
  process.exit(1);
}
const file = existsSync(name) ? name : join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous", name);

function bmp(path: string): { data: Uint8Array; w: number; h: number } {
  const b = readFileSync(path);
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
      const s = off + sy * stride + x * by;
      const d = (y * w + x) * 4;
      out[d] = b[s + 2]!;
      out[d + 1] = b[s + 1]!;
      out[d + 2] = b[s]!;
      out[d + 3] = 255;
    }
  }
  return { data: out, w, h };
}

const { data, w, h } = /\.bmp$/i.test(file)
  ? bmp(file)
  : await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data: d, info }) => ({ data: new Uint8Array(d), w: info.width, h: info.height }));

const app = readHudPitchAnyColour(data, w, h, HUD_PITCH_GLYPHS, HUD_PITCH_GLYPHS_ANY);
console.log(`${name}: ${w}x${h}`);
console.log(`app read (no hint): ${app ? `${app.reading.boxDeg} (pitch ${app.reading.pitchDeg.toFixed(2)}, style ${app.reading.style})` : "not sure"}`);

mkdirSync(outDir, { recursive: true });
const crop = async (b: PitchBox, tag: string) => {
  const xs = b.digits.map((d) => d.x0);
  const xe = b.digits.map((d) => d.x1);
  const ys = b.digits.map((d) => d.y0);
  const ye = b.digits.map((d) => d.y1);
  const pad = Math.round(b.dh * 0.8);
  const left = Math.max(0, Math.min(...xs) - pad * 2);
  const top = Math.max(0, Math.min(...ys) - pad);
  const width = Math.min(w - left, Math.max(...xe) - left + pad * 2);
  const height = Math.min(h - top, Math.max(...ye) - top + pad);
  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width, height })
    .resize({ width: width * 8, kernel: "nearest" })
    .png()
    .toFile(join(outDir, `${tag}.png`));
};

const pairs = pitchPairsAnyColour(data, w, h);
let i = 0;
for (const { colours, look, pair, hinted } of pairs) {
  const per = (b: PitchBox) =>
    b.digits
      .map((c) => {
        const v = glyphVector(data, w, c, GLYPH_W, GLYPH_H, look.ink);
        // the two best digits and their scores, for the margin
        const scores = Object.entries(HUD_PITCH_GLYPHS_ANY)
          .map(([d, list]) => [d, Math.max(...list.map((g) => cos(v, g)))] as const)
          .sort((a, z) => z[1] - a[1]);
        return `${matchGlyph(v, HUD_PITCH_GLYPHS_ANY) ?? "?"} [${scores
          .slice(0, 3)
          .map(([d, s]) => `${d}:${s.toFixed(3)}`)
          .join(" ")}]`;
      })
      .join("  ");
  console.log(
    `pair ${i}: text rgb(${colours.text.join(",")}) frame rgb(${colours.frame.join(",")})${hinted ? " hinted" : ""}\n` +
      `  left  minus=${pair.left.minus} @${pair.left.x},${pair.left.y} dh=${pair.left.dh}: ${per(pair.left)}\n` +
      `  right minus=${pair.right.minus} @${pair.right.x},${pair.right.y} dh=${pair.right.dh}: ${per(pair.right)}`,
  );
  await crop(pair.left, `${name}-pair${i}-left`);
  await crop(pair.right, `${name}-pair${i}-right`);
  i++;
}
console.log(`crops in ${outDir}`);

function cos(a: readonly number[], b: readonly number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let k = 0; k < a.length; k++) {
    ab += a[k]! * b[k]!;
    aa += a[k]! * a[k]!;
    bb += b[k]! * b[k]!;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}
