/**
 * Why a pitch box's outline was not traced (hudPitchReader framedBy), step by step, on chosen shots: the mirrored pair
 * as found colour-blind without the outline (soft finding look), then for each box and each line (above, below) the
 * best line row at the digits' middle column and its contrast, and how far the traced line reached against the digits.
 * The tracer is a copy of framedBy's (keep the two alike). Read-only.
 *
 *   npx tsx scripts/probe-pitch-frame.ts 0716 0371 0759
 */
import { mkdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { homedir } from "node:os";
import { join } from "node:path";
import * as R from "../src/shared/hudPitchReader.js";
import { findPitchBoxes, type PitchBox } from "../src/shared/hudPitchReader.js";
import { findingLook } from "../src/shared/hudTextLook.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");

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

function explain(data: Uint8Array, w: number, h: number, box: PitchBox): string {
  const dh = box.dh;
  const left = Math.min(...box.digits.map((c) => c.x0));
  const right = Math.max(...box.digits.map((c) => c.x1));
  const cx = Math.round((left + right) / 2);
  const top = Math.min(...box.digits.map((c) => c.y0));
  const bottom = Math.max(...box.digits.map((c) => c.y1));
  const line = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 3 || y >= h - 3) return 0;
    const i = (y * w + x) * 4;
    const up = i - 3 * w * 4;
    const dn = i + 3 * w * 4;
    let c = 0;
    for (let k = 0; k < 3; k++) c = Math.max(c, data[i + k]! - Math.max(data[up + k]!, data[dn + k]!));
    return c;
  };
  const MIN = 18;
  // as framedBy: every row ≥ MIN at the middle column, strongest first, until one traces along the box
  const traceFrom = (y0: number) => {
    let x0 = cx;
    let x1 = cx;
    for (const dir of [-1, 1]) {
      let y = y0;
      let gap = 0;
      for (let x = cx + dir; x >= 0 && x < w && gap <= 3; x += dir) {
        let by = y;
        let bc = MIN - 1;
        for (const yy of [y, y - 1, y + 1]) {
          const c = line(x, yy);
          if (c > bc) {
            bc = c;
            by = yy;
          }
        }
        if (bc < MIN) {
          gap++;
          continue;
        }
        gap = 0;
        y = by;
        if (dir < 0) x0 = x;
        else x1 = x;
      }
    }
    return { x0, x1, ok: x0 <= left && x1 >= right && x1 - x0 + 1 >= dh * 2 };
  };
  const trace = (ya: number, yb: number, name: string): string => {
    const rows: { y: number; c: number }[] = [];
    for (let y = ya; y <= yb; y++) rows.push({ y, c: line(cx, y) });
    const tried = rows
      .filter((r) => r.c >= MIN)
      .sort((a, z) => z.c - a.c)
      .map((r) => ({ ...r, ...traceFrom(r.y) }));
    const win = tried.find((t) => t.ok);
    if (win) return `${name}: OK at y ${win.y} (contrast ${win.c}), x ${win.x0}-${win.x1}`;
    const rgb = (y: number) => {
      const i = (y * w + cx) * 4;
      return `${data[i]},${data[i + 1]},${data[i + 2]}`;
    };
    if (!tried.length) {
      const best = rows.reduce((a, z) => (z.c > a.c ? z : a), rows[0]!);
      return `${name}: no row ≥ ${MIN} (best ${best.c} at y ${best.y}: rgb ${rgb(best.y)} vs up ${rgb(best.y - 3)} / down ${rgb(best.y + 3)})`;
    }
    return `${name}: rows tried ${tried.map((t) => `y${t.y}:${t.c}->${t.x0}-${t.x1}`).join(" ")} (digits ${left}-${right}, need ≥ ${dh * 2}) SHORT`;
  };
  return [
    trace(Math.round(top - dh), Math.round(top - dh * 0.2), "above"),
    trace(Math.round(bottom + dh * 0.2), Math.round(bottom + dh), "below"),
  ].join("\n    ");
}

mkdirSync("build-artifacts/pitch-probe", { recursive: true });
for (const n of process.argv.slice(2)) {
  const { data, w, h } = bmp(join(SHOTS, `Screenshot_${n}.bmp`));
  // the HUD's middle with every candidate box the soft look finds, as the reader sees it
  await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: Math.round(w / 2 - 560), top: Math.round(h / 2 - 260), width: 1120, height: 520 })
    .png()
    .toFile(`build-artifacts/pitch-probe/${n}-middle.png`);
  // every string the soft look finds, each with the frame test's answer (needs the temporary exports)
  const all = (R as unknown as { __probeLookBoxes?: (...a: unknown[]) => PitchBox[] | null }).__probeLookBoxes?.(data, w, h, { w, h }, findingLook(115, 60));
  const fb = (R as unknown as { __probeFramedBy?: (...a: unknown[]) => unknown }).__probeFramedBy;
  if (all && fb)
    for (const b of all.filter((x) => Math.abs(x.x - w / 2) < w * 0.14 && x.digits.length))
      console.log(`  string @${b.x},${b.y} dh ${b.dh} ${b.digits.length} digits: frame ${fb(data, w, h, b) ? "YES" : `no${String.fromCharCode(10)}    ${explain(data, w, h, b)}`}`);
  const pair = findPitchBoxes(data, w, h, { w, h }, findingLook(115, 60), false);
  console.log(`${n}: ${pair ? "" : "no mirrored strings"}`);
  if (!pair) continue;
  for (const side of ["left", "right"] as const) {
    const b = pair[side];
    console.log(`  ${side} box @${b.x},${b.y} dh ${b.dh}, ${b.digits.length} digits\n    ${explain(data, w, h, b)}`);
  }
}
