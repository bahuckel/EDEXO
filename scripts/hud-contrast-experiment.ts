/**
 * Experiment (owner 2026-11-07: "normalize the images"): read the pitch boxes on a local-contrast map instead of in a
 * colour. Each pixel becomes its colour's distance from the mean colour around it (a window about a digit high), grey;
 * thin HUD strokes stand out in any colour over any ground. The reader's own finder (framed boxes), outline test, minus
 * test and glyph matching then run on that map, with a glyph table cut from normalised shots.
 *
 *   npx tsx scripts/hud-contrast-experiment.ts @<labels> [@<labels> …] [--threshold 45] [--window 0.006] [--bench 16]
 *
 * Measured like the any-colour builder's --check: the shots in halves, each half read with glyphs from the other; then
 * (with --bench) the theme bench's repainted frames (hud-theme-bench.ts) read with the table from all the shots.
 * Nothing is kept but the counts; the reader in the app is not touched.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findPitchBoxes, glyphVector, GLYPH_H, GLYPH_W, readBox, type PitchColours, type PitchGlyphs } from "../src/shared/hudPitchReader.js";
import type { Rgb, TextLook } from "../src/shared/hudTextLook.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]! : dflt;
};
const T = Number(opt("--threshold", "45"));
const WINDOW = Number(opt("--window", "0.006"));
const BENCH = Number(opt("--bench", "0"));
const MAX_PER_DIGIT = 24;

const labels: [string, number][] = [];
for (const a of args.filter((a) => a.startsWith("@")))
  for (const line of readFileSync(a.slice(1), "utf8").split(/\r?\n/)) {
    const at = line.lastIndexOf("=");
    if (at > 0) labels.push([line.slice(0, at).trim(), Number(line.slice(at + 1))]);
  }

export function crop(name: string): { px: Uint8ClampedArray; cw: number; ch: number; w: number; h: number } {
  const b = readFileSync(join(SHOTS, name));
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
  const px = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const sy = h0 > 0 ? h - 1 - (y + cy0) : y + cy0;
    for (let x = 0; x < cw; x++) {
      const i = off + sy * stride + (x + cx0) * by;
      px.set([b[i + 2]!, b[i + 1]!, b[i]!, 255], (y * cw + x) * 4);
    }
  }
  return { px, cw, ch, w, h };
}

/**
 * The local-contrast map: how much brighter each pixel is than the mean of a (2r+1)² window around it, in its most raised
 * channel, as grey (2×, clamped). Brighter only: the plain distance lit the dark ring round every stroke too (the
 * stroke pulls the window's mean up), which fattened the digits into their outline. Any hue counts; light on dark.
 */
export function normalise(px: Uint8ClampedArray, w: number, h: number, screenH: number): Uint8ClampedArray {
  const r = Math.max(4, Math.round(screenH * WINDOW));
  const W1 = w + 1;
  const sums = [0, 1, 2].map(() => new Float64Array(W1 * (h + 1)));
  for (let k = 0; k < 3; k++) {
    const s = sums[k]!;
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += px[(y * w + x) * 4 + k]!;
        s[(y + 1) * W1 + x + 1] = s[y * W1 + x + 1]! + row;
      }
    }
  }
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      let up = 0;
      for (let k = 0; k < 3; k++) {
        const s = sums[k]!;
        const mean = (s[y1 * W1 + x1]! - s[y0 * W1 + x1]! - s[y1 * W1 + x0]! + s[y0 * W1 + x0]!) / n;
        up = Math.max(up, px[(y * w + x) * 4 + k]! - mean);
      }
      const c = Math.min(255, 2 * up);
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = c;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Strokes on the map: contrast over the threshold; the ink rises from there to full at three times it. */
const contrastLook: TextLook = {
  isText: (r) => r >= T,
  ink: (r) => Math.max(0, Math.min(1, (r - T * 0.5) / (T * 2))),
};

type Cut = { name: string; pitch: number; samples: { digit: string; v: number[] }[] };
function cutShot(name: string, pitch: number): Cut {
  const c = crop(name);
  const g = normalise(c.px, c.cw, c.ch, c.h);
  const pair = findPitchBoxes(g, c.cw, c.ch, { w: c.w, h: c.h }, contrastLook, true);
  const digits = String(Math.abs(pitch));
  const samples: Cut["samples"] = [];
  if (pair && [pair.left, pair.right].every((b) => b.digits.length === digits.length && b.minus === pitch < 0))
    for (const b of [pair.left, pair.right]) b.digits.forEach((r, i) => samples.push({ digit: digits[i]!, v: glyphVector(g, c.cw, r, GLYPH_W, GLYPH_H, contrastLook.ink) }));
  return { name, pitch, samples };
}

const spread = <X>(vs: X[]) => (vs.length <= MAX_PER_DIGIT ? vs : Array.from({ length: MAX_PER_DIGIT }, (_, i) => vs[Math.floor((i * vs.length) / MAX_PER_DIGIT)]!));
function table(cuts: Cut[]): PitchGlyphs {
  const t: Record<string, number[][]> = {};
  for (const c of cuts) for (const s of c.samples) (t[s.digit] ??= []).push(s.v);
  for (const d of Object.keys(t)) t[d] = spread(t[d]!);
  return t;
}

function readOn(px: Uint8ClampedArray, cw: number, ch: number, w: number, h: number, glyphs: PitchGlyphs): number | null {
  const g = normalise(px, cw, ch, h);
  const pair = findPitchBoxes(g, cw, ch, { w, h }, contrastLook, true);
  if (!pair) return null;
  const l = readBox(g, cw, pair.left, glyphs, contrastLook, 0.85, 0.06);
  const r = readBox(g, cw, pair.right, glyphs, contrastLook, 0.85, 0.06);
  return l != null && l === r ? l : null;
}

if (labels.length) await main();
async function main(): Promise<void> {
const t0 = performance.now();
const cuts = labels.map(([n, p]) => cutShot(n, p));
console.log(`threshold ${T}, window ${WINDOW}: samples from ${cuts.filter((c) => c.samples.length).length} of ${cuts.length} shots`);
const by = new Map<string, number[]>();
let reads = 0;
let ms = 0;
for (const half of [0, 1]) {
  const glyphs = table(cuts.filter((_, i) => i % 2 !== half));
  for (const [i, [name, pitch]] of labels.entries()) {
    if (i % 2 !== half) continue;
    const c = crop(name);
    const s = performance.now();
    const v = readOn(c.px, c.cw, c.ch, c.w, c.h, glyphs);
    ms += performance.now() - s;
    reads++;
    const n = Number(name.slice(11, 15));
    const set = n < 330 ? "default" : n < 400 ? "ace" : n < 799 ? "b" : "c";
    const row = by.get(set) ?? [0, 0, 0];
    row[v == null ? 1 : v === pitch ? 0 : 2]!++;
    by.set(set, row);
    if (v != null && v !== pitch) console.log(`  wrong ${name}: ${v} (is ${pitch})`);
  }
}
for (const [set, r] of by) console.log(`held out ${set}: ${r[0]} right / ${r[1]} not sure / ${r[2]} wrong`);
console.log(`${(ms / reads).toFixed(1)} ms a read (normalise + find + read), ${((performance.now() - t0) / 1000).toFixed(0)} s in all`);

if (BENCH) {
  const glyphs = table(cuts);
  const THEMES = join(homedir(), "EDHM_UI", "ODYSS", "Themes");
  const argb = (v: number): Rgb => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const themes = new Map<string, PitchColours>();
  for (const d of readdirSync(THEMES)) {
    try {
      const j = JSON.parse(readFileSync(join(THEMES, d, "ThemeSettings.json"), "utf8")) as { ui_groups?: { Elements?: { Key?: string; Value?: number }[] }[] };
      const keys = new Map<string, number>();
      for (const gr of j.ui_groups ?? []) for (const e of gr.Elements ?? []) if (e.Key && typeof e.Value === "number") keys.set(e.Key, e.Value);
      const t = keys.get("x95|y95|z95|w95");
      const f = keys.get("x209|y209|z209|w209");
      if (t != null && f != null) themes.set(`${argb(t)}|${argb(f)}`, { text: argb(t), frame: argb(f) });
    } catch {
      /* skip */
    }
  }
  // The bench's sources: saturated shots whose colours the colour reader learns (as hud-theme-bench.ts).
  const { readHudPitchAnyColour } = await import("../src/shared/hudPitchReader.js");
  const { HUD_PITCH_GLYPHS_ANY } = await import("../src/shared/hudPitchGlyphsAny.js");
  const sat = (c: Rgb) => Math.max(...c) - Math.min(...c) >= 90;
  const sources: { pitch: number; c: ReturnType<typeof crop>; colours: PitchColours }[] = [];
  for (let k = 0; k < labels.length && sources.length < BENCH; k++) {
    const [name, pitch] = labels[Math.floor((k * 7919) % labels.length)]!;
    if (Number(name.slice(11, 15)) < 647) continue;
    const c = crop(name);
    const r = readHudPitchAnyColour(c.px, c.cw, c.ch, {}, HUD_PITCH_GLYPHS_ANY, { w: c.w, h: c.h });
    if (!r?.colours || r.reading.boxDeg !== pitch || !sat(r.colours.text) || !sat(r.colours.frame)) continue;
    sources.push({ pitch, c, colours: r.colours });
  }
  const norm = (c: Rgb) => Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1;
  const repaint = (src: Uint8ClampedArray, from: PitchColours, to: PitchColours) => {
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
  };
  const tot = [0, 0, 0];
  for (const th of themes.values())
    for (const s of sources) {
      const v = readOn(repaint(s.c.px, s.colours, th), s.c.cw, s.c.ch, s.c.w, s.c.h, glyphs);
      tot[v == null ? 1 : v === s.pitch ? 0 : 2]!++;
    }
  console.log(`bench (${sources.length} sources × ${themes.size} themes): ${tot.join(" / ")} (right / not sure / wrong)`);
}
}
