/*
  The HUD's shared helpers: the server's address, formatting, list limits.

  The HUD overlays were plain browser modules under public/hud/ until 1.2.17; since then they are React (plan 3.8,
  owner 2026-10-15: "hud rewrite in react - now"), built by Vite like the app, with the same markup and the same
  hud.css. These helpers came over as they were.
*/
import type { HudSnapshot } from "./types";

let lastPort = 7111;
/** The feed learns the server's port from each snapshot (only used off http, e.g. file://). */
export function setPort(p: number): void {
  lastPort = p;
}
export function api(p: string): string {
  const proto = location.protocol || "";
  if (proto === "http:" || proto === "https:") return p;
  return "http://127.0.0.1:" + lastPort + p;
}

/*
  Rows a list shows before a "+N more" line (plan 2.1, Fable C2). The overlay windows are click-through
  — the mouse goes to the game — so a list that scrolled was simply cut, with nothing to say so. The
  phone HUD can scroll and shows them all.
*/
export const HUD_LIST_ROWS = 9;
export function listRowLimit(rows: number): number {
  return document.body && document.body.classList.contains("phone") ? Infinity : rows;
}

export function fmtCr(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString() + " CR";
}
export function fmtM(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return Math.round(n) + " m";
}

/*
  The metres readout counts rather than steps (see Metres in parts.tsx): short and linear, a big change snaps.
*/
export const COUNT_MS = 180;
export const COUNT_SNAP_M = 250;

export function fmtClock(ms: number): string {
  if (!(ms >= 0)) return "";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number) => (n < 10 ? "0" : "") + n;
  return h > 0 ? h + ":" + two(m % 60) + ":" + two(s % 60) : two(m) + ":" + two(s % 60);
}
/** "tussock propagito" → "Tussock Propagito"; the game writes species in lower case after the genus. */
export function cap(s: string | null | undefined): string {
  return String(s || "")
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
export function norm(s: string | null | undefined): string {
  return String(s || "")
    .trim()
    .toLowerCase();
}
export function ls(key: string, def: string | null): string | null {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : v;
  } catch {
    return def;
  }
}
/** Safe in text and in either kind of quoted attribute (the radar and the route strip build markup). */
export function esc(t: unknown): string {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A section's state colour: the frame turns green (ok) or amber (warn). */
export type SectionState = "ok" | "warn" | null;

/** The page's HUD object: main.tsx fills it; theme and audio read `serverPrefs` / `onCue` off it. */
export interface HudObject {
  serverPrefs: Record<string, unknown> | null;
  lastSnapshot: HudSnapshot | null;
  onCue?: (kind: string) => unknown;
  [k: string]: unknown;
}
export const HUD = { serverPrefs: null, lastSnapshot: null } as HudObject;
