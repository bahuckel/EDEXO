import { HUD, ls } from "./core";
import { PRESETS } from "./presets";

export { PRESETS };

/* ============================================================== colour theme ================= */
/*
  One accent colour drives the whole panel; the rest is derived so a custom colour still gets the
  dim/faint/glow ladder the frame and rules are built from. Presets are the cockpit colours people
  actually use. Text defaults to a pale tint of the accent so it reads on dark video.
*/
type Rgb = [number, number, number];

export function hexRgb(h: unknown): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || "").trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(c: Rgb, a: number): string {
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}
export function mix(c: Rgb, w: Rgb, t: number): Rgb {
  return [
    Math.round(c[0] + (w[0] - c[0]) * t),
    Math.round(c[1] + (w[1] - c[1]) * t),
    Math.round(c[2] + (w[2] - c[2]) * t),
  ];
}
export function toHex(c: Rgb): string {
  return "#" + c.map((v) => (v < 16 ? "0" : "") + v.toString(16)).join("");
}
/*
  Phone mode (owner, 2026-09-13, task 13): `?phone=1` on the merged page. A phone has its own
  localStorage, so the settings come from the server's mirror of the launcher (`d.hudPrefs`),
  which the launcher writes on every change. On the PC the local keys still win.
*/
export const PHONE = /[?&]phone=1(&|$)/.test(String(location.search || ""));
export function serverPref(key: string): string | null {
  const p = HUD.serverPrefs as Record<string, unknown> | null;
  if (!p) return null;
  const bool = (v: unknown) => (typeof v === "boolean" ? (v ? "1" : "0") : null);
  const numStr = (v: unknown) => (typeof v === "number" ? String(v) : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  switch (key) {
    case "edexoHudTheme":
      return p.theme ? JSON.stringify(p.theme) : null;
    case "edexoHudScale":
      return numStr(p.scale);
    case "edexoHudOpacity":
      return numStr(p.opacity);
    case "edexoHudCandOrder":
      return str(p.candOrder);
    case "edexoHudRegion":
      return bool(p.region);
    case "edexoHudAudio":
      return bool(p.audio);
    case "edexoHudCompact":
      return bool(p.compact);
    case "edexoHudRelevant":
      return bool(p.relevant);
    case "edexoHudType":
      return str(p.hudType);
    case "edexoHudCredit":
      return str(p.credit);
    case "edexoHudNextBoxel":
      return bool(p.nextBoxel);
    case "edexoHudRefuelBar":
      return bool(p.refuelBar);
    case "edexoHudCzNeeds":
      return bool(p.czNeeds);
    case "edexoHudCzSites":
      return bool(p.czSites);
    case "edexoHudCzFinished":
      return bool(p.czFinished);
    case "edexoHudTilt":
      return numStr(p.tilt);
    case "edexoHudTiltMode":
      return str(p.tiltMode);
    case "edexoHudSlant":
      return numStr(p.slant);
    default:
      return null;
  }
}
export function pref(key: string, def: string): string {
  let v = PHONE ? null : ls(key, null);
  if (v == null) v = serverPref(key);
  return v == null ? def : v;
}
export function readTheme(): { accent: Rgb; text: Rgb } {
  let t: { preset?: string; accent?: string; text?: string } = {};
  try {
    t = (JSON.parse(pref("edexoHudTheme", "{}")) as typeof t) || {};
  } catch {
    t = {};
  }
  const preset = (t.preset && PRESETS[t.preset]) || null;
  const accent =
    hexRgb(t.preset === "custom" ? t.accent : preset ? preset.accent : PRESETS.orange!.accent) ||
    hexRgb(PRESETS.orange!.accent)!;
  // A text colour of one's own goes over any scheme (owner, 2026-10-31: it was lost when switching presets).
  const text =
    hexRgb(t.text) ||
    hexRgb(t.preset === "custom" ? undefined : preset ? preset.text : PRESETS.orange!.text) ||
    mix(accent, [255, 255, 255], 0.78);
  return { accent, text };
}
/*
  Size and panel opacity (owner, 2026-09-13): two sliders in the launcher, remembered like the
  colour. Scale multiplies the root font size, so every rem in the page follows; the host widens
  the window by the same factor (see reportHeight). Opacity is the panel fill's alpha.
*/
export function clampNum(v: unknown, lo: number, hi: number, def: number): number {
  const n = parseFloat(String(v));
  if (!isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
export function readScale(): number {
  // The phone has its own size: the launcher's slider is for the overlay on the game screen.
  if (PHONE) return 1;
  return clampNum(pref("edexoHudScale", "1"), 0.5, 2, 1);
}
/*
  Background opacity (owner, 2026-09-14): the panel fill's alpha only — text, icons and lines
  stay solid, and the fill keeps its colour; the slider decides how much of the game shows
  through it. 42 % is the design default.
*/
export function readOpacity(): number {
  if (PHONE) return 0.7;
  return clampNum(pref("edexoHudOpacity", "0.45"), 0.1, 1, 0.45);
}
/*
  "HUD Overlay by EDEXO" (owner, 2026-10-09/10; "by EDEXO-Compare" until 1.3.0): off unless chosen, at the top or the bottom of the
  panel, shown "like the other titles": a section of its own with a section title and nothing under it, so
  every HUD type draws it as it draws theirs. The panel (Panel.tsx) places it from this.
*/
export function creditPlace(): "top" | "bottom" | null {
  const credit = pref("edexoHudCredit", "off");
  return credit === "top" || credit === "bottom" ? credit : null;
}

/** Re-render on a settings change (the panel subscribes; theme.ts cannot import React's store). */
const themeListeners = new Set<() => void>();
export function onThemeApplied(l: () => void): () => void {
  themeListeners.add(l);
  return () => themeListeners.delete(l);
}

export function applyTheme(): void {
  const th = readTheme();
  const a = th.accent;
  const st = document.documentElement.style;
  st.fontSize = Math.round(readScale() * 100) + "%";
  /*
    The slider runs from clear to a dark orange panel (owner, 2026-09-14: "not a second sun"):
    the fill is a near-black orange whose alpha follows the slider up to 92 %, the frame hairline
    dims with it. 45 % is roughly the old default look.
  */
  const t = readOpacity();
  st.setProperty("--hud-bg-opacity", String(t));
  st.setProperty("--hud", toHex(a));
  st.setProperty("--hud-hi", toHex(mix(a, [255, 255, 255], 0.35)));
  st.setProperty("--hud-text", toHex(th.text));
  st.setProperty("--hud-dim", rgba(a, 0.55));
  st.setProperty("--hud-faint", rgba(a, 0.22));
  st.setProperty("--hud-ghost", rgba(a, 0.1));
  st.setProperty("--hud-bg", rgba(mix(a, [0, 0, 0], 0.9), Math.round(92 * t) / 100));
  st.setProperty("--hud-bg-2", rgba(mix(a, [0, 0, 0], 0.8), Math.round(35 * t) / 100));
  st.setProperty("--hud-glow", "0 0 6px " + rgba(a, 0.45));
  // Compact (guild tester, 2026-09-30): the explanatory lines (`.hud-explain`) are hidden.
  document.documentElement.classList.toggle("hud-compact", pref("edexoHudCompact", "0") === "1");
  /*
    HUD type (owner, 2026-10-04): Original (default), Title Background, Elite Style. The Elite Style's
    tilt turns the panel like the cockpit's side panels; its far edge always goes into the screen
    (the pivot is the near side), so nothing grows past the window.
  */
  const type = pref("edexoHudType", "original");
  const cls = document.documentElement.classList;
  cls.toggle("hud-type--title", type === "title");
  cls.toggle("hud-type--elite", type === "elite");
  /*
    Not on a phone (owner, 2026-10-15): the angle is for the panel at the side of the game screen; a phone held in
    the hand, and turned, keeps the Elite Style's look straight.
  */
  const tilt = PHONE ? 0 : clampNum(pref("edexoHudTilt", "15"), -35, 35, 15);
  st.setProperty("--hud-tilt", tilt + "deg");
  st.setProperty("--hud-tilt-origin", tilt >= 0 ? "left" : "right");
  /*
    Slant (owner, 2026-10-04: "angle adjust without the swinging part"): the panel skewed rather than
    turned, so its edges stay where they are and only the lines and text run at the angle. A skew
    lifts one end and lowers the other by half the width × tan(angle), which the window has to hold:
    that much padding above and below.
  */
  const slantMode = !PHONE && pref("edexoHudTiltMode", "turn") === "slant";
  cls.toggle("hud-tilt--slant", slantMode);
  const slant = clampNum(pref("edexoHudSlant", "6"), -15, 15, 6);
  st.setProperty("--hud-slant", -slant + "deg");
  const halfLift = (Math.tan((Math.abs(slant) * Math.PI) / 180) * (window.innerWidth || 420)) / 2;
  st.setProperty("--hud-slant-pad", Math.ceil(halfLift + 4) + "px");
  for (const l of themeListeners) l();
}
