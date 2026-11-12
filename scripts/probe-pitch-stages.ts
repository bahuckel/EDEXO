/**
 * Where the colour-blind pitch search stops on a shot (2026-11-13: 40 of 742 labelled shots found no framed pair). For
 * each of the two finding looks the search uses (hudPitchReader PITCH_FINDING_LOOKS: strict 170 / 90, soft 115 / 60):
 *   too bright   - more than MAX_TEXT_SHARE of the middle 40 % marked as text or star, the search gives up;
 *   no strings   - no mirrored pair of number strings at all;
 *   no frame     - the pair is there, but the outline was not traced round both boxes;
 *   pair found   - a framed pair (the any-colour read decides from there).
 * Read-only. Labels as probe-pitch-labels.ts; --only <names> to limit to some shots.
 *
 *   npx tsx scripts/probe-pitch-stages.ts @docs/hud-pitch-labels-edhm-07112026b.txt [--only 0716,0759]
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findPitchBoxes, pitchPairsAnyColour } from "../src/shared/hudPitchReader.js";
import { findingLook, MAX_TEXT_SHARE } from "../src/shared/hudTextLook.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");
const args = process.argv.slice(2);
const oi = args.indexOf("--only");
const only = oi >= 0 ? new Set(args[oi + 1]!.split(",").map((s) => `Screenshot_${s}.bmp`)) : null;
const LOOKS = { strict: findingLook(170, 90), soft: findingLook(115, 60) };
const isStar = (r: number, g: number, b: number) => r > 200 && g > 200 && b > 200;

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

const tally = new Map<string, number>();
for (const a of args.filter((x) => x.startsWith("@")))
  for (const line of readFileSync(a.slice(1), "utf8").split(/\r?\n/)) {
    const m = /^\s*([^#=\s][^=]*?)\s*=\s*(-?\d+)\s*$/.exec(line);
    if (!m || (only && !only.has(m[1]!))) continue;
    const file = join(SHOTS, m[1]!);
    if (!/\.bmp$/i.test(file) || !existsSync(file)) continue;
    const { data, w, h } = bmp(file);
    // only the shots the any-colour path finds no framed pair on
    if (pitchPairsAnyColour(data, w, h).length) continue;
    const rx0 = Math.floor(w / 2 - w * 0.2);
    const rx1 = Math.ceil(w / 2 + w * 0.2);
    const ry0 = Math.floor(h / 2 - h * 0.2);
    const ry1 = Math.ceil(h / 2 + h * 0.2);
    const parts: string[] = [];
    for (const [name, look] of Object.entries(LOOKS)) {
      let marked = 0;
      for (let y = ry0; y < ry1; y++)
        for (let x = rx0; x < rx1; x++) {
          const i = (y * w + x) * 4;
          if (look.isText(data[i]!, data[i + 1]!, data[i + 2]!) || isStar(data[i]!, data[i + 1]!, data[i + 2]!)) marked++;
        }
      const share = marked / ((rx1 - rx0) * (ry1 - ry0));
      let stage: string;
      if (share > MAX_TEXT_SHARE) stage = "too bright";
      else if (!findPitchBoxes(data, w, h, { w, h }, look, false)) stage = "no strings";
      else if (!findPitchBoxes(data, w, h, { w, h }, look, true)) stage = "no frame";
      else stage = "pair found";
      parts.push(`${name}: ${stage} (${(share * 100).toFixed(1)} % marked)`);
      tally.set(`${name} ${stage}`, (tally.get(`${name} ${stage}`) ?? 0) + 1);
    }
    console.log(`${m[1]}=${m[2]}  ${parts.join("; ")}`);
  }
console.log("tally:");
for (const [k, n] of [...tally].sort()) console.log(`  ${n}  ${k}`);
