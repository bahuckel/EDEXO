/**
 * The distance reader on every EDHM theme, without photographing them (as scripts/hud-theme-bench.ts does for the
 * pitch reader). Each source shot — the owner's labelled EDHM F10s whose target text is a saturated colour, so the
 * repaint cannot catch grey ground — is repainted into each theme's main text colour (server edhmColours.ts
 * edhmTargetText: x77 under w75 = 100, the game's orange through the XML matrix under 199; themes in the game's own
 * orange are left out), and read as the capture reads it (the search area), with that colour as the hint and without.
 *
 *   npx tsx scripts/hud-distance-theme-bench.ts @<labels> [--sources 12] [--themes <dir>]
 *
 * The repaint: a pixel pointing along the source colour (cosine 0.97, at least a quarter of its brightness) is taken
 * as background + a · source and becomes background + a · target. Themes with the same colour are benched once; the
 * shots and themes are not kept, only the counts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { edhmTargetText } from "../src/server/edhmColours.js";
import { HUD_DISTANCE_GLYPHS } from "../src/shared/hudDistanceGlyphs.js";
import { HUD_DISTANCE_GLYPHS_ORANGE } from "../src/shared/hudDistanceGlyphsOrange.js";
import { distanceArea, readTargetDistanceAnyColour } from "../src/shared/hudTargetDistance.js";
import type { Rgb } from "../src/shared/hudTextLook.js";

const SHOTS = join(homedir(), "Pictures", "Frontier Developments", "Elite Dangerous");
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]! : dflt;
};
const SOURCES = Number(opt("--sources", "12"));
const THEMES = opt("--themes", join(homedir(), "EDHM_UI", "ODYSS", "Themes"));
const labels = new Map<string, string>();
for (const a of args.filter((a) => a.startsWith("@")))
  for (const line of readFileSync(a.slice(1), "utf8").split(/\r?\n/)) {
    const at = line.lastIndexOf("=");
    if (at > 0) labels.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

/** The capture's search area of an Elite F10 .bmp. */
function crop(name: string): { px: Uint8ClampedArray; cw: number; ch: number; h: number } {
  const b = readFileSync(join(SHOTS, name));
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h0 = b.readInt32LE(22);
  const by = b.readUInt16LE(28) / 8;
  const h = Math.abs(h0);
  const stride = Math.ceil((w * by) / 4) * 4;
  const a = distanceArea(w, h);
  const px = new Uint8ClampedArray(a.w * a.h * 4);
  for (let y = 0; y < a.h; y++) {
    const sy = h0 > 0 ? h - 1 - (y + a.y) : y + a.y;
    for (let x = 0; x < a.w; x++) {
      const i = off + sy * stride + (x + a.x) * by;
      px.set([b[i + 2]!, b[i + 1]!, b[i]!, 255], (y * a.w + x) * 4);
    }
  }
  return { px, cw: a.w, ch: a.h, h };
}

const norm = (c: Rgb) => Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) || 1;
const saturated = (c: Rgb) => Math.max(...c) - Math.min(...c) >= 90;

/** Source colour → target colour, pixel by pixel (see the header). */
function repaint(src: Uint8ClampedArray, s: Rgb, t: Rgb): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const n = norm(s);
  const u = [s[0] / n, s[1] / n, s[2] / n] as const;
  for (let i = 0; i < out.length; i += 4) {
    const r = src[i]!;
    const g = src[i + 1]!;
    const b = src[i + 2]!;
    const len = Math.sqrt(r * r + g * g + b * b);
    if (len < 1) continue;
    const along = r * u[0] + g * u[1] + b * u[2];
    if (along / len < 0.97) continue;
    const a = along / n;
    if (a < 0.25) continue;
    out[i] = r + a * (t[0] - s[0]);
    out[i + 1] = g + a * (t[1] - s[1]);
    out[i + 2] = b + a * (t[2] - s[2]);
  }
  return out;
}

/** A theme's colours as EDHM writes them to its ini (linear, keyed `x77` …), for edhmTargetText. */
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
type Theme = { name: string; colour: Rgb };
const themes = new Map<string, Theme>();
const themeDirs = readdirSync(THEMES);
for (const d of themeDirs) {
  try {
    const j = JSON.parse(readFileSync(join(THEMES, d, "ThemeSettings.json"), "utf8")) as {
      ui_groups?: { Elements?: { Key?: string; Value?: number }[] }[];
      xml_profile?: { key: string; value: number }[];
    };
    const ini = new Map<string, number>();
    for (const g of j.ui_groups ?? [])
      for (const e of g.Elements ?? []) {
        if (!e.Key || typeof e.Value !== "number") continue;
        const parts = e.Key.split("|");
        if (parts.length >= 3) {
          const v = e.Value;
          [(v >> 16) & 255, (v >> 8) & 255, v & 255].forEach((c, i) => ini.set(parts[i]!, toLinear(c)));
        } else ini.set(e.Key, e.Value);
      }
    const xml = new Map((j.xml_profile ?? []).map((q) => [q.key, q.value] as const));
    const colour = edhmTargetText(ini, ini, xml);
    if (!colour) continue;
    const key = colour.join(",");
    if (!themes.has(key)) themes.set(key, { name: d, colour });
  } catch {
    /* a folder without settings */
  }
}

// Sources: shots that read right as they are, in saturated colours, spread over the label list.
const names = [...labels.keys()];
const sources: { name: string; want: string; px: Uint8ClampedArray; cw: number; ch: number; h: number; colour: Rgb }[] = [];
for (let k = 0; k < names.length && sources.length < SOURCES; k++) {
  const name = names[Math.floor((k * 7919) % names.length)]!;
  if (sources.some((s) => s.name === name)) continue;
  const c = crop(name);
  const r = readTargetDistanceAnyColour(c.px, c.cw, c.ch, HUD_DISTANCE_GLYPHS, c.h, null, HUD_DISTANCE_GLYPHS_ORANGE);
  if (!r || r.reading.text !== labels.get(name) || !saturated(r.colour)) continue;
  sources.push({ name, want: labels.get(name)!, ...c, colour: r.colour });
}
console.log(`${sources.length} source shots, ${themes.size} distinct recoloured texts (of ${themeDirs.length} themes)`);

const total = { hint: [0, 0, 0], blind: [0, 0, 0] };
const ms = { hint: 0, blind: 0 };
const rows: string[] = [];
for (const th of themes.values()) {
  const per = { hint: [0, 0, 0], blind: [0, 0, 0] };
  for (const s of sources) {
    const px = repaint(s.px, s.colour, th.colour);
    for (const mode of ["hint", "blind"] as const) {
      const t0 = performance.now();
      const r = readTargetDistanceAnyColour(px, s.cw, s.ch, HUD_DISTANCE_GLYPHS, s.h, null, HUD_DISTANCE_GLYPHS_ORANGE, mode === "hint" ? th.colour : null);
      ms[mode] += performance.now() - t0;
      const k = !r ? 1 : r.reading.text === s.want ? 0 : 2;
      per[mode][k]!++;
      total[mode][k]!++;
      if (k === 2) rows.push(`  WRONG ${mode} ${th.name}: ${s.name} read ${r!.reading.text} (is ${s.want})`);
    }
  }
  rows.push(`${th.name.padEnd(36)} text ${th.colour.join(",").padEnd(12)} hint ${per.hint.join("/")}  blind ${per.blind.join("/")}`);
}
for (const r of rows) console.log(r);
const n = themes.size * sources.length;
console.log(
  `all (right/not sure/wrong of ${n}): hint ${total.hint.join("/")} (${(ms.hint / n).toFixed(0)} ms a read), blind ${total.blind.join("/")} (${(ms.blind / n).toFixed(0)} ms)`,
);
