/**
 * Every labelled F10 shot through the app's pitch read (readHudPitchAnyColour with the shipped tables, no hint), counted
 * right / not sure / wrong, the wrongs listed, and the "not sure" shots whose label holds a digit given (default 8, 9,
 * 6: the glow fills an 8's holes on some themes, 1349). Read-only: nothing is written.
 *
 *   npx tsx scripts/probe-pitch-labels.ts @docs/hud-pitch-labels-edhm-07112026c.txt [@…] [--digits 689]
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { glyphVector, GLYPH_H, GLYPH_W, pitchPairsAnyColour, readHudPitchAnyColour } from "../src/shared/hudPitchReader.js";
import { HUD_PITCH_GLYPHS } from "../src/shared/hudPitchGlyphs.js";
import { HUD_PITCH_GLYPHS_ANY } from "../src/shared/hudPitchGlyphsAny.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");
const args = process.argv.slice(2);
const di = args.indexOf("--digits");
const digits = di >= 0 ? args[di + 1]! : "689";
const pairs: [string, number][] = [];
const source = new Map<string, string>();
const noPair: string[] = [];
for (const a of args)
  if (a.startsWith("@"))
    for (const line of readFileSync(a.slice(1), "utf8").split(/\r?\n/)) {
      const m = /^\s*([^#=\s][^=]*?)\s*=\s*(-?\d+)\s*$/.exec(line);
      if (m) {
        pairs.push([m[1]!, Number(m[2])]);
        source.set(m[1]!, a.slice(1).replace(/^.*hud-pitch-labels-/, "").replace(/\.txt$/, ""));
      }
    }

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

let right = 0;
let unsure = 0;
const wrong: string[] = [];
const unsureDigits: string[] = [];
let missing = 0;
// why "not sure": per shot the first framed pair's digits, top two candidates; the any-colour thresholds (0.85 / 0.06)
const ANY_MIN_MATCH = 0.85;
const ANY_MIN_MARGIN = 0.06;
const why = new Map<string, number>();
const roundPair: string[] = [];
/*
  Prototype tie-break for two round digits scoring close (1349: the glow fills an 8's holes): at full resolution, three
  spots tell them apart even when the holes are lit. Lower-left: closed on 8 / 6 / 0, open on 9. Upper-right: closed on
  8 / 9 / 0, open on 6. Middle: crossed on 8, empty on 0. Each spot's ink, scaled to the digit's own darkest and
  brightest, counts as closed above 0.55, open below 0.35; anything between decides nothing.
*/
type InkFn = (r: number, g: number, b: number) => number;
const SPOTS: Record<string, [number, number]> = { lowLeft: [0.14, 0.7], upRight: [0.86, 0.3], middle: [0.5, 0.5] };
const SHAPE: Record<string, Record<string, boolean>> = {
  "0": { lowLeft: true, upRight: true, middle: false },
  "6": { lowLeft: true, upRight: false, middle: true },
  "8": { lowLeft: true, upRight: true, middle: true },
  "9": { lowLeft: false, upRight: true, middle: true },
};
function spots(data: Uint8Array, w: number, c: { x0: number; y0: number; x1: number; y1: number }, ink: InkFn) {
  let lo = 1;
  let hi = 0;
  for (let y = c.y0; y <= c.y1; y++)
    for (let x = c.x0; x <= c.x1; x++) {
      const i = (y * w + x) * 4;
      const v = ink(data[i]!, data[i + 1]!, data[i + 2]!);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const out: Record<string, boolean | null> = {};
  for (const [k, [fx, fy]] of Object.entries(SPOTS)) {
    const cx = c.x0 + fx * (c.x1 - c.x0);
    const cy = c.y0 + fy * (c.y1 - c.y0);
    let s = 0;
    let n = 0;
    for (let y = Math.round(cy - 0.5); y <= Math.round(cy + 0.5); y++)
      for (let x = Math.round(cx - 0.5); x <= Math.round(cx + 0.5); x++) {
        const i = (y * w + x) * 4;
        s += ink(data[i]!, data[i + 1]!, data[i + 2]!);
        n++;
      }
    const v = hi > lo ? (s / n - lo) / (hi - lo) : 0.5;
    out[k] = v > 0.55 ? true : v < 0.35 ? false : null;
  }
  return out;
}
/** The one of two round digits the spots agree with, or null. */
function tieBreak(a: string, b: string, sp: Record<string, boolean | null>): string | null {
  const fits = (d: string) => Object.entries(SHAPE[d]!).every(([k, want]) => sp[k] == null || sp[k] === want);
  // a spot that tells the two apart must have been seen
  const telling = Object.keys(SPOTS).filter((k) => SHAPE[a]![k] !== SHAPE[b]![k]);
  if (!telling.every((k) => sp[k] != null)) return null;
  const fa = fits(a);
  const fb = fits(b);
  return fa && !fb ? a : fb && !fa ? b : null;
}
let tbRight = 0;
let tbWrong = 0;
let tbUndecided = 0;
const tbWrongList: string[] = [];
const top2 = (v: number[]) =>
  Object.entries(HUD_PITCH_GLYPHS_ANY)
    .map(([d, list]) => [d, Math.max(...list.map((g) => g.reduce((t, x, i) => t + x * v[i]!, 0)))] as const)
    .sort((a, z) => z[1] - a[1]);
for (const [name, label] of pairs) {
  const file = existsSync(name) ? name : join(SHOTS, name);
  if (!existsSync(file)) {
    missing++;
    continue;
  }
  const img = /\.bmp$/i.test(file)
    ? bmp(file)
    : await sharp(file)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
        .then(({ data, info }) => ({ data: new Uint8Array(data), w: info.width, h: info.height }));
  const r = readHudPitchAnyColour(img.data, img.w, img.h, HUD_PITCH_GLYPHS, HUD_PITCH_GLYPHS_ANY);
  if (!r) {
    unsure++;
    const pairs2 = pitchPairsAnyColour(img.data, img.w, img.h);
    let reason = "no framed pair";
    if (!pairs2.length) noPair.push(`${name}=${label} (${source.get(name)})`);
    if (pairs2.length) {
      const { look, pair } = pairs2[0]!;
      const want = String(Math.abs(label));
      const doubts: string[] = [];
      for (const b of [pair.left, pair.right]) {
        if (b.digits.length !== want.length) {
          doubts.push(`count ${b.digits.length}/${want.length}`);
          continue;
        }
        if (b.minus !== label < 0) doubts.push("minus");
        b.digits.forEach((c, k) => {
          const t = top2(glyphVector(img.data, img.w, c, GLYPH_W, GLYPH_H, look.ink));
          const [d1, s1] = t[0]!;
          const [d2, s2] = t[1]!;
          if (s1 < ANY_MIN_MATCH) doubts.push(`low ${want[k]}:${s1.toFixed(2)}`);
          else if (s1 - s2 < ANY_MIN_MARGIN) doubts.push(`close ${d1}/${d2}${d1 === want[k] ? "" : " (top wrong)"}`);
          else if (d1 !== want[k]) doubts.push(`reads ${d1} for ${want[k]}`);
        });
      }
      reason = doubts.length ? doubts.join(", ") : "digits fine (guard / pair check)";
      if (doubts.length && doubts.every((x) => /^close [0689]\/[0689]/.test(x))) {
        roundPair.push(`${name}=${label}: ${doubts.join(", ")}`);
        // the prototype: every close digit through the tie-break; both boxes must then read the label
        let undecided = false;
        const readsOf = [pair.left, pair.right].map((b) =>
          b.digits
            .map((c) => {
              const t = top2(glyphVector(img.data, img.w, c, GLYPH_W, GLYPH_H, look.ink));
              if (t[0]![1] - t[1]![1] >= ANY_MIN_MARGIN) return t[0]![0];
              const d = tieBreak(t[0]![0], t[1]![0], spots(img.data, img.w, c, look.ink));
              if (d == null) undecided = true;
              return d ?? "?";
            })
            .join(""),
        );
        if (undecided) tbUndecided++;
        else if (readsOf[0] === String(Math.abs(label)) && readsOf[1] === readsOf[0]) tbRight++;
        else {
          tbWrong++;
          tbWrongList.push(`${name}=${label} read ${readsOf.join("/")}`);
        }
      }
    }
    const key = reason.replace(/[0-9.]+/g, "#").replace(/ \(top wrong\)/, "");
    why.set(key, (why.get(key) ?? 0) + 1);
    if ([...String(Math.abs(label))].some((c) => digits.includes(c))) unsureDigits.push(`${name}=${label}`);
  } else if (r.reading.boxDeg === label) right++;
  else wrong.push(`${name}=${label} read ${r.reading.boxDeg} (${r.reading.style})`);
}
console.log(`${pairs.length} labelled, ${missing} missing: ${right} right, ${unsure} not sure, ${wrong.length} wrong`);
if (wrong.length) console.log(`wrong:\n  ${wrong.join("\n  ")}`);
console.log("why not sure (kinds):");
for (const [k, n] of [...why].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}  ${k}`);
console.log(`not sure only because two of 0 6 8 9 score close: ${roundPair.length}`);
for (const line of roundPair.slice(0, 30)) console.log(`  ${line}`);
console.log(`no framed pair: ${noPair.length}`);
for (const line of noPair) console.log(`  NOPAIR ${line}`);
console.log(`tie-break prototype on those: ${tbRight} right, ${tbWrong} wrong, ${tbUndecided} still not sure`);
for (const line of tbWrongList) console.log(`  WRONG ${line}`);
console.log(`not sure with a ${digits.split("").join(" / ")} in the label: ${unsureDigits.length}\n  ${unsureDigits.join("\n  ")}`);
