/**
 * One shot repainted into a theme's two colours, as hud-theme-bench.ts repaints it, and read: for a wrong or not-sure
 * line in the bench (2026-11-13: 1116 "-74" read 74 in nine themes, 1043 "-24" read 4 in one). The source colours are
 * learned on the shot as it is (it must read). Optionally the repainted frame saved as a .bmp, for probe-pitch-shot.ts.
 * Read-only except that file.
 *
 *   npx tsx scripts/probe-pitch-theme.ts 1116 <text r g b> <frame r g b> [out.bmp]
 *   npx tsx scripts/probe-pitch-theme.ts 1116 231 231 231 255 255 255
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HUD_PITCH_GLYPHS } from "../src/shared/hudPitchGlyphs.js";
import { HUD_PITCH_GLYPHS_ANY } from "../src/shared/hudPitchGlyphsAny.js";
import { readHudPitchAnyColour, type PitchColours } from "../src/shared/hudPitchReader.js";
import type { Rgb } from "../src/shared/hudTextLook.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");
const norm = (c: Rgb) => Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1;

/** As hud-theme-bench.ts: a pixel along a source colour becomes background + a · target (keep the two alike). */
function repaint(src: Uint8ClampedArray, from: PitchColours, to: PitchColours): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const pairs = [
    { s: from.text, t: to.text },
    { s: from.frame, t: to.frame },
  ].map(({ s, t }) => ({ s, t, n: norm(s), u: [s[0] / norm(s), s[1] / norm(s), s[2] / norm(s)] }));
  for (let i = 0; i < out.length; i += 4) {
    const r = src[i]!;
    const g = src[i + 1]!;
    const b = src[i + 2]!;
    const len = Math.sqrt(r * r + g * g + b * b);
    if (len < 1) continue;
    let best: (typeof pairs)[number] | null = null;
    let bestCos = 0.97;
    for (const p of pairs) {
      const cos = (r * p.u[0]! + g * p.u[1]! + b * p.u[2]!) / len;
      if (cos > bestCos) {
        bestCos = cos;
        best = p;
      }
    }
    if (!best) continue;
    const a = (r * best.u[0]! + g * best.u[1]! + b * best.u[2]!) / best.n;
    if (a < 0.25) continue;
    out[i] = r + a * (best.t[0] - best.s[0]);
    out[i + 1] = g + a * (best.t[1] - best.s[1]);
    out[i + 2] = b + a * (best.t[2] - best.s[2]);
  }
  return out;
}

const [name, tr, tg, tb, fr, fg, fb, out] = process.argv.slice(2);
const b = readFileSync(join(SHOTS, `Screenshot_${name}.bmp`));
const off = b.readUInt32LE(10);
const w = b.readInt32LE(18);
const h0 = b.readInt32LE(22);
const by = b.readUInt16LE(28) / 8;
const h = Math.abs(h0);
const stride = Math.ceil((w * by) / 4) * 4;
const px = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) {
  const sy = h0 > 0 ? h - 1 - y : y;
  for (let x = 0; x < w; x++) {
    const i = off + sy * stride + x * by;
    px.set([b[i + 2]!, b[i + 1]!, b[i]!, 255], (y * w + x) * 4);
  }
}
const first = readHudPitchAnyColour(px, w, h, {}, HUD_PITCH_GLYPHS_ANY);
if (!first?.colours) throw new Error(`Screenshot_${name} does not read in learned colours as it is`);
const to: PitchColours = { text: [Number(tr), Number(tg), Number(tb)], frame: [Number(fr), Number(fg), Number(fb)] };
const painted = repaint(px, first.colours, to);
console.log(`source: read ${first.reading.boxDeg}, colours ${JSON.stringify(first.colours)}`);
const r = readHudPitchAnyColour(painted, w, h, HUD_PITCH_GLYPHS, HUD_PITCH_GLYPHS_ANY);
console.log(`repainted: ${r ? `read ${r.reading.boxDeg}, roll ${r.reading.rollDeg.toFixed(1)}, colours ${JSON.stringify(r.colours)}` : "not sure"}`);
if (out) {
  const row = w * 3;
  const file = Buffer.alloc(54 + row * h);
  file.write("BM", 0);
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(54, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(w, 18);
  file.writeInt32LE(-h, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = 54 + y * row + x * 3;
      file[d] = painted[s + 2]!;
      file[d + 1] = painted[s + 1]!;
      file[d + 2] = painted[s]!;
    }
  writeFileSync(out, file);
}
