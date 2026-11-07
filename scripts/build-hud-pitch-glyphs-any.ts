/**
 * Rebuild src/shared/hudPitchGlyphsAny.ts, the pitch boxes' digits in any HUD colour, from screenshots whose pitch is
 * known (owner's EDHM shots, 2026-11-07).
 *
 *   npx tsx scripts/build-hud-pitch-glyphs-any.ts <image>=<pitch> [<image>=<pitch> …] [@<list file>] [--check]
 *
 * The owner's labels: docs/hud-pitch-labels-06112026.txt (default HUD) and docs/hud-pitch-labels-edhm-07112026.txt
 * (his green EDHM theme), bare names looked for in Pictures\Frontier Developments\Elite Dangerous. In each image the
 * pairs the reader would try (hudPitchReader.ts pitchPairsAnyColour: framed boxes, colours learned from them) give one
 * sample per digit and box from the first pair whose boxes hold the pitch's digits and sign, cut in that pair's colour.
 * Every sample is kept up to MAX_PER_DIGIT a digit, spread over the images.
 * --check: before writing, each half of the images is read with glyphs from the other half (the any-colour reader
 * alone, the default tables left out), and the misses listed. The images are not kept; only the numbers go in the table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { glyphVector, GLYPH_H, GLYPH_W, pitchPairsAnyColour, readHudPitchAnyColour, type PitchGlyphs } from "../src/shared/hudPitchReader.js";

const MAX_PER_DIGIT = 24;

async function rgba(file: string): Promise<{ data: Uint8Array; w: number; h: number }> {
  if (/\.bmp$/i.test(file)) {
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
        out.set([b[i + 2]!, b[i + 1]!, b[i]!, 255], (y * w + x) * 4);
      }
    }
    return { data: out, w, h };
  }
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const pairs = args
  .filter((a) => a !== "--check")
  .flatMap((a) => (a.startsWith("@") ? readFileSync(a.slice(1), "utf8").split(/\r?\n/).filter((l) => l.trim()) : [a]))
  .map((a) => {
    const at = a.lastIndexOf("=");
    const file = a.slice(0, at).trim();
    return { file: /[\\/]/.test(file) ? file : join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous", file), pitch: Number(a.slice(at + 1)) };
  });

type Sample = { digit: string; v: number[] };
/** Each image's samples (--check reads the images again rather than keep them: 20 MB each). */
const per: { file: string; pitch: number; samples: Sample[] }[] = [];
for (const { file, pitch } of pairs) {
  const name = file.split(/[\\/]/).pop();
  const digits = String(Math.abs(pitch));
  const img = await rgba(file);
  const samples: Sample[] = [];
  for (const { look, pair } of pitchPairsAnyColour(img.data, img.w, img.h)) {
    const boxes = [pair.left, pair.right];
    if (boxes.some((b) => b.digits.length !== digits.length || b.minus !== pitch < 0)) continue;
    for (const b of boxes) b.digits.forEach((c, i) => samples.push({ digit: digits[i]!, v: glyphVector(img.data, img.w, c, GLYPH_W, GLYPH_H, look.ink) }));
    break;
  }
  console.log(`${name}: ${samples.length ? `${samples.length} samples` : "no framed pair with those digits"}`);
  per.push({ file, pitch, samples });
}

/** Spread the kept samples over the list (they came in image order). */
const spread = <T>(vs: T[]) => (vs.length <= MAX_PER_DIGIT ? vs : Array.from({ length: MAX_PER_DIGIT }, (_, i) => vs[Math.floor((i * vs.length) / MAX_PER_DIGIT)]!));
function table(from: typeof per): Record<string, number[][]> {
  const t: Record<string, number[][]> = {};
  for (const p of from) for (const s of p.samples) (t[s.digit] ??= []).push(s.v);
  for (const d of Object.keys(t)) t[d] = spread(t[d]!);
  return t;
}

if (check) {
  let right = 0;
  let unsure = 0;
  const wrong: string[] = [];
  for (const half of [0, 1]) {
    const glyphs: PitchGlyphs = table(per.filter((_, i) => i % 2 !== half));
    for (const [i, p] of per.entries()) {
      if (i % 2 !== half) continue;
      const img = await rgba(p.file);
      const r = readHudPitchAnyColour(img.data, img.w, img.h, {}, glyphs)?.reading ?? null;
      if (!r) unsure++;
      else if (r.boxDeg === p.pitch) right++;
      else wrong.push(`${p.file.split(/[\\/]/).pop()}: ${r.boxDeg} (is ${p.pitch})`);
    }
  }
  console.log(`held out: ${right} right, ${unsure} not sure, ${wrong.length} wrong of ${per.length}`);
  for (const w of wrong) console.log(`  wrong ${w}`);
}

const all = table(per);
console.log(Object.keys(all).sort().map((d) => `${d}x${all[d]!.length}`).join(" "));
const out = [
  "/**",
  " * The HUD pitch boxes' digits in any HUD colour as the reader compares them (hudPitchReader.ts readHudPitchAnyColour;",
  " * glyphVector 10 x 15, zero mean, unit length, cut in each box's learned colour), every sample kept up to 24 a digit:",
  " * the reader matches the nearest. Built by scripts/build-hud-pitch-glyphs-any.ts from the owner's F10 cockpit",
  " * screenshots with a known pitch, default HUD and EDHM. Derived numbers, no image.",
  " */",
  'import type { PitchGlyphs } from "./hudPitchReader.js";',
  "",
  "export const HUD_PITCH_GLYPHS_ANY: PitchGlyphs = {",
  ...Object.keys(all)
    .sort()
    .flatMap((d) => [`  "${d}": [`, ...all[d]!.map((v) => `    [${v.map((x) => Math.round(x * 100) / 100).join(", ")}],`), "  ],"]),
  "};",
  "",
].join("\n");
writeFileSync(new URL("../src/shared/hudPitchGlyphsAny.ts", import.meta.url), out);
console.log("written src/shared/hudPitchGlyphsAny.ts");
