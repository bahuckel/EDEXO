/**
 * The pitch reader's time a frame, as the capture reads it: the middle 40 % of each shot, the screen's own size given
 * (pitchCapture.ts), colours searched (`discover`). Three passes after a warm-up; prints ms a read and how many read.
 * Compare two versions of the reader on the same shots (git stash the other one). Read-only.
 *
 *   npx tsx scripts/probe-pitch-time.ts 0754 0759 0775 … [--no-discover]
 *
 * --no-discover: as the capture's frames between searches (three of four unread ones): the game's look only.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readHudPitchAnyColour } from "../src/shared/hudPitchReader.js";
import { HUD_PITCH_GLYPHS } from "../src/shared/hudPitchGlyphs.js";
import { HUD_PITCH_GLYPHS_ANY } from "../src/shared/hudPitchGlyphsAny.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");

function crop(path: string): { data: Uint8Array; w: number; h: number; screen: { w: number; h: number } } {
  const b = readFileSync(path);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h0 = b.readInt32LE(22);
  const by = b.readUInt16LE(28) / 8;
  const h = Math.abs(h0);
  const stride = Math.ceil((w * by) / 4) * 4;
  const cw = Math.round(w * 0.4);
  const ch = Math.round(h * 0.4);
  const cx0 = Math.round((w - cw) / 2);
  const cy0 = Math.round((h - ch) / 2);
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const sy = h0 > 0 ? h - 1 - (y + cy0) : y + cy0;
    for (let x = 0; x < cw; x++) {
      const s = off + sy * stride + (x + cx0) * by;
      const d = (y * cw + x) * 4;
      out[d] = b[s + 2]!;
      out[d + 1] = b[s + 1]!;
      out[d + 2] = b[s]!;
      out[d + 3] = 255;
    }
  }
  return { data: out, w: cw, h: ch, screen: { w, h } };
}

const args = process.argv.slice(2);
const discover = !args.includes("--no-discover");
const frames = args.filter((a) => !a.startsWith("--")).map((n) => crop(join(SHOTS, `Screenshot_${n}.bmp`)));
const read = (f: (typeof frames)[number]) =>
  readHudPitchAnyColour(f.data, f.w, f.h, HUD_PITCH_GLYPHS, HUD_PITCH_GLYPHS_ANY, f.screen, null, discover);
for (const f of frames.slice(0, 3)) read(f);
const t = performance.now();
let ok = 0;
for (let pass = 0; pass < 3; pass++) for (const f of frames) if (read(f)) ok++;
console.log(`${((performance.now() - t) / (frames.length * 3)).toFixed(1)} ms a read, ${ok / 3} of ${frames.length} read`);
