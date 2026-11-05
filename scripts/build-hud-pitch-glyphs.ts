/**
 * Rebuild src/shared/hudPitchGlyphs.ts from screenshots whose HUD pitch is known (owner, 2026-11-04).
 *
 *   npx tsx scripts/build-hud-pitch-glyphs.ts <image>=<pitch> [<image>=<pitch> …] [@<list file>]
 *
 * The owner's labels: docs/hud-pitch-labels-06112026.txt (102 shots, bare names).
 * Images: Elite's own F10 screenshots (full-size .bmp, Pictures\Frontier Developments\Elite Dangerous) or any .png /
 * .jpg / .webp sharp reads. Each one's pitch boxes are found as the reader finds them (shared/hudPitchReader.ts), in
 * the yellow look (gear up) or else the orange one (landing gear down), and each digit's glyph is cut from both boxes
 * when the box holds the pitch's number of digits. Every sample is kept (the reader matches the nearest one), up to
 * MAX_PER_DIGIT per digit and look, spread over the images. The images are not kept; only the numbers go in the table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { findPitchBoxes, glyphVector, GLYPH_H, GLYPH_W, styleInk, type HudStyleName } from "../src/shared/hudPitchReader.js";

const MAX_PER_DIGIT = 12;

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

const samples: Record<HudStyleName, Record<string, number[][]>> = { yellow: {}, orange: {} };
// A list file (@file, one <image>=<pitch> a line) keeps 100+ shots under Windows' command-line limit.
const args = process.argv.slice(2).flatMap((a) => (a.startsWith("@") ? readFileSync(a.slice(1), "utf8").split(/\r?\n/).filter((l) => l.trim()) : [a]));
for (const arg of args) {
  const at = arg.lastIndexOf("=");
  const name = arg.slice(0, at).trim();
  // Elite's own folder for a bare name.
  const file = /[\\/]/.test(name) ? name : join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous", name);
  const digits = String(Math.abs(Number(arg.slice(at + 1))));
  const { data, w, h } = await rgba(file);
  let used: HudStyleName | null = null;
  for (const style of ["yellow", "orange"] as const) {
    const pair = findPitchBoxes(data, w, h, { w, h }, style);
    if (!pair) continue;
    let any = false;
    for (const box of [pair.left, pair.right]) {
      if (box.digits.length !== digits.length) continue;
      any = true;
      box.digits.forEach((c, i) => (samples[style][digits[i]!] ??= []).push(glyphVector(data, w, c, GLYPH_W, GLYPH_H, styleInk(style))));
    }
    if (any) {
      used = style;
      break;
    }
  }
  console.log(`${file.split(/[\\/]/).pop()}: ${used ?? "no boxes with that many digits"}`);
}

/** Spread the kept samples over the list (they came in image order). */
const spread = (vs: number[][]) => (vs.length <= MAX_PER_DIGIT ? vs : Array.from({ length: MAX_PER_DIGIT }, (_, i) => vs[Math.floor((i * vs.length) / MAX_PER_DIGIT)]!));
const lines: string[] = [];
for (const style of ["yellow", "orange"] as const) {
  const digits = Object.keys(samples[style]).sort();
  console.log(`${style}: ${digits.map((d) => `${d}x${samples[style][d]!.length}`).join(" ")}`);
  if (!digits.length) continue;
  lines.push(`  ${style}: {`);
  for (const d of digits)
    lines.push(`    "${d}": [`, ...spread(samples[style][d]!).map((v) => `      [${v.map((x) => Math.round(x * 100) / 100).join(", ")}],`), "    ],");
  lines.push("  },");
}

const out = [
  "/**",
  " * The HUD pitch and heading boxes' digits as the reader compares them (hudPitchReader.ts glyphVector: 10 x 15, zero",
  " * mean, unit length), per HUD look (yellow gear up, orange landing gear down), every sample kept: the reader matches",
  " * the nearest. Built by scripts/build-hud-pitch-glyphs.ts from the owner's F10 cockpit screenshots with a known pitch.",
  " * A digit missing here reads as not sure (the marker then keeps its last reading). Derived numbers, no image.",
  " */",
  'import type { HudGlyphs } from "./hudPitchReader.js";',
  "",
  "export const HUD_PITCH_GLYPHS: HudGlyphs = {",
  ...lines,
  "};",
  "",
].join("\n");
writeFileSync(new URL("../src/shared/hudPitchGlyphs.ts", import.meta.url), out);
console.log("written src/shared/hudPitchGlyphs.ts");
