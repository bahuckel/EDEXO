/**
 * The HUD colours EDHM (Elite Dangerous HUD Mod, a shader mod) draws the pitch boxes and the target's distance in, read
 * from its own files, for the screen marker's readers (owner 2026-11-07: "reading the .ini files" instead of thousands of
 * photos).
 *
 * EDHM-UI's `%USERPROFILE%\EDHM_UI\Settings.json` names the active game instance and its folder; the game folder holds
 * `d3dx.ini` (3Dmigoto, EDHM installed) and `EDHM-ini\Advanced.ini`, whose "Planetary Landing Reticle" section has
 *   x95 / y95 / z95 — Text in Reticle Boxes (the pitch and heading boxes' digits),
 *   x209 / y209 / z209 — Planetary Landing Reticle (the boxes' outline and the pitch ladder),
 * and "Orange Text Color Swap" x77 / y77 / z77 — the main text colour (the target's name and distance under its
 * bracket: the hue the distance reader learned on 10 of his 12 EDHM themes; Orokin Vision Black drew it red against a
 * gold x77), used only when `Startup-Profile.ini` sets w75 = 100 (custom); w75 = 199 tints the game's orange with the
 * XML colour matrix of `XML-Profile.ini` (x150-z152, rows red, green, blue: his Interstellar Ultra Blue, cyan), 200 is
 * the game's own orange. All as linear 0-1 channels through the sRGB curve: EDHM-UI's 165 / 255 orange is stored as
 * 0.3763 (a plain 2.2 power gives 164). Measured on the owner's 1,036 F10 shots in 22 themes (EDHM-UI's History
 * snapshots by time): the screen shows each colour's hue, not its brightness (ini 243 grey on screen 150 gear up, 239
 * gear down), so the readers take it as a hint for finding the text and learn the exact colour from it (hudTextLook.ts
 * hueLook).
 *
 * Re-read only when a file's time changes (F11 in game reloads a theme; the capture asks every 5 s). Null without EDHM.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Rgb } from "../shared/hudTextLook.js";

export interface EdhmColours {
  /** The pitch and heading boxes' digits. */
  pitchText: Rgb;
  /** The boxes' outline and the pitch ladder. */
  pitchFrame: Rgb;
  /** The main text (the target's distance), null when it is the game's own orange. */
  targetText: Rgb | null;
}

/** The game folder EDHM-UI is set to (its active instance), or null. */
export function edhmGameFolder(home = os.homedir()): string | null {
  try {
    const s = JSON.parse(readFileSync(path.join(home, "EDHM_UI", "Settings.json"), "utf8")) as {
      ActiveInstance?: unknown;
      GameInstances?: { games?: { instance?: unknown; path?: unknown }[] }[];
    };
    for (const gi of s.GameInstances ?? [])
      for (const g of gi.games ?? [])
        if (g.instance === s.ActiveInstance && typeof g.path === "string" && g.path.trim()) return g.path.trim();
  } catch {
    /* no EDHM-UI */
  }
  return null;
}

/** `key = number` lines of an EDHM ini. */
export function parseEdhmIni(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([xyzw]\d+)\s*=\s*(-?[0-9.]+)\s*$/.exec(line);
    if (m) out.set(m[1]!, Number(m[2]));
  }
  return out;
}

/** The game's own text orange, linear (EDHM's "Elite default" x77). */
const GAME_ORANGE: readonly number[] = [1, 0.3763, 0];

/** Linear 0-1 to an sRGB 0-255 channel. */
const toSrgb = (v: number) => {
  const c = Math.max(0, Math.min(1, v));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};

/** An ini colour (`x<n>`, `y<n>`, `z<n>`, linear 0-1) as the screen shows it, or null when a channel is missing. */
export function edhmColour(ini: Map<string, number>, n: number): Rgb | null {
  const ch = (k: string) => {
    const v = ini.get(`${k}${n}`);
    return v == null || !Number.isFinite(v) ? null : toSrgb(v);
  };
  const r = ch("x");
  const g = ch("y");
  const b = ch("z");
  return r == null || g == null || b == null ? null : [r, g, b];
}

/**
 * The main text colour by Startup-Profile's w75 mode: 100 custom (Advanced x77), 199 the game's orange through the XML
 * matrix (each input channel adds its row), 200 or unset the game's own (null).
 */
export function edhmTargetText(startup: Map<string, number>, advanced: Map<string, number>, xml: Map<string, number>): Rgb | null {
  const mode = startup.get("w75");
  if (mode === 100) return edhmColour(advanced, 77);
  if (mode !== 199) return null;
  const rows = [150, 151, 152].map((n) => ["x", "y", "z"].map((a) => xml.get(`${a}${n}`)));
  if (rows.some((r) => r.some((v) => v == null || !Number.isFinite(v)))) return null;
  const out = [0, 1, 2].map((j) => toSrgb(GAME_ORANGE.reduce((sum, c, i) => sum + c * rows[i]![j]!, 0)));
  return [out[0]!, out[1]!, out[2]!];
}

let memo: { key: string; value: EdhmColours | null } | null = null;

/** An EDHM ini's keys, empty when the file is missing. */
const readIni = (file: string) => (existsSync(file) ? parseEdhmIni(readFileSync(file, "utf8")) : new Map<string, number>());

/** EDHM's pitch box and text colours on this PC, or null (no EDHM-UI, no EDHM in the game folder, keys missing). */
export function readEdhmColours(home = os.homedir()): EdhmColours | null {
  const game = edhmGameFolder(home);
  if (!game || !existsSync(path.join(game, "d3dx.ini"))) return null;
  const dir = path.join(game, "EDHM-ini");
  const [advanced, startup, xml] = ["Advanced.ini", "Startup-Profile.ini", "XML-Profile.ini"].map((f) => path.join(dir, f)) as [string, string, string];
  let key: string;
  try {
    key = [advanced, startup, xml].map((f) => `${f}|${existsSync(f) ? statSync(f).mtimeMs : "-"}`).join("|");
  } catch {
    return null;
  }
  if (memo?.key === key) return memo.value;
  let value: EdhmColours | null = null;
  try {
    const ini = readIni(advanced);
    const pitchText = edhmColour(ini, 95);
    const pitchFrame = edhmColour(ini, 209);
    value = pitchText && pitchFrame ? { pitchText, pitchFrame, targetText: edhmTargetText(readIni(startup), ini, readIni(xml)) } : null;
  } catch {
    value = null;
  }
  memo = { key, value };
  return value;
}
