/**
 * The pitch reader on every EDHM theme, without photographing them (owner 2026-11-07: 100-150 colour sets × 30-100 shots
 * is out). Each source shot — the owner's labelled F10s whose theme draws the pitch boxes in saturated colours, so the
 * repaint cannot catch grey ground — is repainted into each theme's two colours from EDHM-UI's theme files (x95 text in
 * the reticle boxes, x209 the planetary landing reticle = the boxes' outline), and read as the capture reads it (the
 * middle 40 %), with the theme's colours as the hint (server edhmColours.ts) and without.
 *
 *   npx tsx scripts/hud-theme-bench.ts @<labels> [@<labels> …] [--sources 24] [--themes <dir>]
 *
 * The repaint: a pixel pointing along a source colour (cosine 0.97, at least a quarter of its brightness) is taken as
 * background + a · source and becomes background + a · target, so the glow and the blend with the ground follow. Each
 * source shot must read right as it is (its colours learned on it); the shots and themes are not kept, only the counts.
 * Themes with the same two colours are benched once.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HUD_PITCH_GLYPHS } from "../src/shared/hudPitchGlyphs.js";
import { HUD_PITCH_GLYPHS_ANY } from "../src/shared/hudPitchGlyphsAny.js";
import { readHudPitchAnyColour, type PitchColours } from "../src/shared/hudPitchReader.js";
import type { Rgb } from "../src/shared/hudTextLook.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]! : dflt;
};
const SOURCES = Number(opt("--sources", "24"));
const THEMES = opt("--themes", join(homedir(), "EDHM_UI", "ODYSS", "Themes"));
const labels = new Map<string, number>();
for (const a of args.filter((a) => a.startsWith("@")))
  for (const line of readFileSync(a.slice(1), "utf8").split(/\r?\n/)) {
    const at = line.lastIndexOf("=");
    if (at > 0) labels.set(line.slice(0, at).trim(), Number(line.slice(at + 1)));
  }

/** The middle 40 % of an Elite F10 .bmp, as the capture crops it. */
function crop(name: string): { px: Uint8ClampedArray; cw: number; ch: number; w: number; h: number } {
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

const norm = (c: Rgb) => Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1;
const saturated = (c: Rgb) => Math.max(...c) - Math.min(...c) >= 90;

/** Source colours → target colours, pixel by pixel (see the header). */
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

const argb = (v: number): Rgb => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
type Theme = { name: string; colours: PitchColours };
const themes = new Map<string, Theme>();
for (const d of readdirSync(THEMES)) {
  try {
    const j = JSON.parse(readFileSync(join(THEMES, d, "ThemeSettings.json"), "utf8")) as {
      ui_groups?: { Elements?: { Key?: string; Value?: number }[] }[];
    };
    const keys = new Map<string, number>();
    for (const g of j.ui_groups ?? []) for (const e of g.Elements ?? []) if (e.Key && typeof e.Value === "number") keys.set(e.Key, e.Value);
    const t = keys.get("x95|y95|z95|w95");
    const f = keys.get("x209|y209|z209|w209");
    if (t == null || f == null) continue;
    const colours = { text: argb(t), frame: argb(f) };
    const key = `${colours.text}|${colours.frame}`;
    if (!themes.has(key)) themes.set(key, { name: d, colours });
  } catch {
    /* a folder without settings */
  }
}

// Sources: shots that read right as they are, in saturated colours, spread over the label list.
const names = [...labels.keys()];
const sources: { name: string; pitch: number; px: Uint8ClampedArray; cw: number; ch: number; w: number; h: number; colours: PitchColours }[] = [];
for (let k = 0; k < names.length && sources.length < SOURCES; k++) {
  const name = names[Math.floor((k * 7919) % names.length)]!;
  if (sources.some((s) => s.name === name)) continue;
  const c = crop(name);
  const r = readHudPitchAnyColour(c.px, c.cw, c.ch, {}, HUD_PITCH_GLYPHS_ANY, { w: c.w, h: c.h });
  if (!r?.colours || r.reading.boxDeg !== labels.get(name)) continue;
  if (!saturated(r.colours.text) || !saturated(r.colours.frame)) continue;
  sources.push({ name, pitch: labels.get(name)!, ...c, colours: r.colours });
}
console.log(`${sources.length} source shots, ${themes.size} distinct themes (of ${readdirSync(THEMES).length})`);

const total = { hint: [0, 0, 0], blind: [0, 0, 0] };
const rows: string[] = [];
const t0 = performance.now();
for (const th of themes.values()) {
  const per = { hint: [0, 0, 0], blind: [0, 0, 0] };
  for (const s of sources) {
    const px = repaint(s.px, s.colours, th.colours);
    for (const mode of ["hint", "blind"] as const) {
      const r = readHudPitchAnyColour(px, s.cw, s.ch, HUD_PITCH_GLYPHS, HUD_PITCH_GLYPHS_ANY, { w: s.w, h: s.h }, null, true, mode === "hint" ? th.colours : null);
      const k = !r ? 1 : r.reading.boxDeg === s.pitch ? 0 : 2;
      per[mode][k]!++;
      total[mode][k]!++;
      if (k === 2) rows.push(`  WRONG ${mode} ${th.name}: ${s.name} read ${r!.reading.boxDeg} (is ${s.pitch})`);
    }
  }
  rows.push(
    `${th.name.padEnd(36)} text ${th.colours.text.join(",").padEnd(12)} frame ${th.colours.frame.join(",").padEnd(12)} hint ${per.hint.join("/")}  blind ${per.blind.join("/")}`,
  );
}
for (const r of rows) console.log(r);
const n = themes.size * sources.length;
console.log(`all (right/not sure/wrong of ${n}): hint ${total.hint.join("/")}, blind ${total.blind.join("/")}; ${((performance.now() - t0) / (2 * n)).toFixed(0)} ms a read`);
