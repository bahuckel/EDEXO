/**
 * Rebuild src/shared/hudDistanceGlyphs.ts from screenshots whose target distance is known (plan 1.3.8, Scan route
 * travelling arrow; owner's F10 shots 2026-11-05).
 *
 *   npx tsx scripts/build-hud-distance-glyphs.ts <image>=<text> [<image>=<text> …] [@<list file>] [--check]
 *
 * <text> as the HUD shows it ("1,957Ls", "8.59Ls", "13.1Mm"); a list file has one <image>=<text> a line. Images:
 * Elite's own F10 screenshots (full-size .bmp; a bare file name is looked for in Pictures\Frontier Developments\Elite
 * Dangerous) or any .png / .jpg / .webp sharp reads. In each, the line read as the
 * target's (hudTargetDistance.ts: a distance with the time line under it) gives one sample per character when it
 * holds the text's number of figures. Every sample is kept up to MAX_PER_GLYPH a glyph, spread over the images.
 * --check: before writing, each half of the images is read with glyphs from the other half, and the misses listed.
 * The images are not kept; only the numbers go in the table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  cutDistanceLine,
  candidateTextColours,
  findTextLines,
  lineUnder,
  lookFromColour,
  readTargetDistanceAnyColour,
  type DistanceGlyphs,
} from "../src/shared/hudTargetDistance.js";

const MAX_PER_GLYPH = 24;

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
    // Elite's own folder for a bare name (the owner's label list names the shots only).
    return { file: /[\\/]/.test(file) ? file : join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous", file), text: a.slice(at + 1).trim() };
  });

type Sample = { glyph: string; small: boolean; v: number[] };
/** Each image's samples (--check reads the images again rather than keep them: 20 MB each). */
const per: { file: string; text: string; samples: Sample[] }[] = [];
for (const { file, text } of pairs) {
  const m = /^([\d,.]+)(Ls|Mm|km)$/.exec(text);
  const name = file.split(/[\\/]/).pop();
  if (!m) {
    console.log(`${name}: "${text}" is not a distance`);
    continue;
  }
  const figures = m[1]!.replace(/[,.]/g, "");
  const img = await rgba(file);
  // In the colour the screen's HUD is drawn in (2026-11-06: his EDHM shots, white, blue, red, ...; the default orange
  // the same way): the first colour found whose target line has the label's number of figures.
  let cuts: { figures: number[][]; cap: number[]; small: number[] }[] = [];
  for (const c of candidateTextColours(img.data, img.w, img.h)) {
    const look = lookFromColour(c);
    const lines = findTextLines(img.data, img.w, img.h, img.h, look);
    cuts = lines
      .filter((l) => lineUnder(lines, l))
      .map((l) => cutDistanceLine(img.data, img.w, l, look))
      .filter((x): x is NonNullable<typeof x> => !!x && x.figures.length === figures.length);
    if (cuts.length) break;
  }
  const samples: Sample[] = [];
  // Only an image with one such line: two (another label beside the target's) cannot say which is which.
  if (cuts.length === 1) {
    const c = cuts[0]!;
    c.figures.forEach((v, i) => samples.push({ glyph: figures[i]!, small: false, v }));
    samples.push({ glyph: m[2]![0]!, small: false, v: c.cap }, { glyph: m[2]![1]!, small: true, v: c.small });
  }
  console.log(`${name}: ${samples.length ? `${samples.length} samples` : `${cuts.length} lines of that shape`}`);
  per.push({ file, text, samples });
}

/** Spread the kept samples over the list (they came in image order). */
const spread = <T>(vs: T[]) => (vs.length <= MAX_PER_GLYPH ? vs : Array.from({ length: MAX_PER_GLYPH }, (_, i) => vs[Math.floor((i * vs.length) / MAX_PER_GLYPH)]!));
function table(from: typeof per): { tall: Record<string, number[][]>; small: Record<string, number[][]> } {
  const t = { tall: {} as Record<string, number[][]>, small: {} as Record<string, number[][]> };
  for (const p of from) for (const s of p.samples) ((s.small ? t.small : t.tall)[s.glyph] ??= []).push(s.v);
  for (const k of ["tall", "small"] as const) for (const g of Object.keys(t[k])) t[k][g] = spread(t[k][g]!);
  return t;
}

if (check) {
  let right = 0;
  let unsure = 0;
  const wrong: string[] = [];
  for (const half of [0, 1]) {
    const glyphs: DistanceGlyphs = table(per.filter((_, i) => i % 2 !== half));
    for (const [i, p] of per.entries()) {
      if (i % 2 !== half) continue;
      const img = await rgba(p.file);
      const r = readTargetDistanceAnyColour(img.data, img.w, img.h, glyphs)?.reading ?? null;
      if (!r) unsure++;
      else if (r.text === p.text) right++;
      else wrong.push(`${p.file.split(/[\\/]/).pop()}: ${r.text} (is ${p.text})`);
    }
  }
  console.log(`held out: ${right} right, ${unsure} not sure, ${wrong.length} wrong of ${per.length}`);
  for (const w of wrong) console.log(`  wrong ${w}`);
}

const all = table(per);
const block = (k: "tall" | "small") => [
  `  ${k}: {`,
  ...Object.keys(all[k])
    .sort()
    .flatMap((g) => [`    "${g}": [`, ...all[k][g]!.map((v) => `      [${v.map((x) => Math.round(x * 100) / 100).join(", ")}],`), "    ],"]),
  "  },",
];
for (const k of ["tall", "small"] as const) console.log(`${k}: ${Object.keys(all[k]).sort().map((g) => `${g}x${all[k][g]!.length}`).join(" ")}`);
const out = [
  "/**",
  " * The HUD's target distance characters as the reader compares them (hudTargetDistance.ts; glyphVector 10 x 15, zero",
  " * mean, unit length): figures and the unit's capital (tall), the unit's small letter (small); every sample kept up to",
  " * 24 a glyph, the reader matching the nearest. Built by scripts/build-hud-distance-glyphs.ts from the owner's F10",
  " * cockpit screenshots with a known distance. Derived numbers, no image.",
  " */",
  'import type { DistanceGlyphs } from "./hudTargetDistance.js";',
  "",
  "export const HUD_DISTANCE_GLYPHS: DistanceGlyphs = {",
  ...block("tall"),
  ...block("small"),
  "};",
  "",
].join("\n");
writeFileSync(new URL("../src/shared/hudDistanceGlyphs.ts", import.meta.url), out);
console.log("written src/shared/hudDistanceGlyphs.ts");
