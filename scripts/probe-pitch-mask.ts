/**
 * A region of an F10 shot as the pitch search's mask sees it, one character a pixel: "#" marked by a finding look
 * (hudTextLook findingLook, default the soft 115 / 60), "*" a star pixel (r, g, b > 200), "." neither. For seeing why
 * a box's digits joined its outline or each other (2026-11-13: the cyan theme's arrow edge, 0759; a minus joined on,
 * 0754 / 0762). Read-only.
 *
 *   npx tsx scripts/probe-pitch-mask.ts 0759 1455 632 1523 660 [115 60]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findingLook } from "../src/shared/hudTextLook.js";

const [n, x0, y0, x1, y1, a, b] = process.argv.slice(2);
const buf = readFileSync(join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous", `Screenshot_${n}.bmp`));
const off = buf.readUInt32LE(10);
const w = buf.readInt32LE(18);
const h0 = buf.readInt32LE(22);
const by = buf.readUInt16LE(28) / 8;
const h = Math.abs(h0);
const stride = Math.ceil((w * by) / 4) * 4;
const look = findingLook(Number(a ?? 115), Number(b ?? 60));
for (let y = Number(y0); y <= Number(y1); y++) {
  let s = `${String(y).padStart(5)} `;
  for (let x = Number(x0); x <= Number(x1); x++) {
    const i = off + (h0 > 0 ? h - 1 - y : y) * stride + x * by;
    const r = buf[i + 2]!;
    const g = buf[i + 1]!;
    const bl = buf[i]!;
    s += r > 200 && g > 200 && bl > 200 ? "*" : look.isText(r, g, bl) ? "#" : ".";
  }
  console.log(s);
}
