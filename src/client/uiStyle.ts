/**
 * Interface style (2026-11-16; Options › Look › Interface style). The same app drawn three ways. A style changes the
 * whole picture (the page behind the app, how a panel is made, how its title is said, what a tile is) and takes its
 * colour from the colour scheme, so the two multiply.
 *   classic  as it was
 *   holo     a cockpit hologram: corner brackets instead of boxes, glowing titles, scan lines, a cold dark
 *   nebula   glass over a coloured sky: see-through panels, the scheme's colour and its neighbours behind
 * Owner 2026-11-16, of five tried: "holo and nebula glass look good, add them" (Blueprint and Terminal dropped; a
 * first round of border / shadow / padding variants before them: "not big enough difference").
 * Kept per PC like the colour scheme; `<html data-ui-style>` carries it and styles/ui-styles.css keys on it.
 */
import { useSyncExternalStore } from "react";

export type UiStyle = "classic" | "holo" | "nebula";

export const UI_STYLES: { style: UiStyle; label: string; note: string }[] = [
  { style: "classic", label: "Classic", note: "flat panels with a thin frame, the look the app has always had" },
  { style: "holo", label: "Holo", note: "a cockpit hologram: corner brackets instead of boxes, glowing titles, scan lines" },
  { style: "nebula", label: "Nebula", note: "glass over a coloured sky: see-through panels with the scheme's colours behind" },
];

const KEY = "edexo.uiStyle";
export const UI_STYLE_EVENT = "edexo:ui-style";

export function uiStyle(): UiStyle {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "holo" || v === "nebula") return v;
  } catch {
    /* storage blocked: the default */
  }
  return "classic";
}

/** Puts the style on <html> (before the first paint) and keeps it there. */
export function applyUiStyle(): void {
  if (typeof document === "undefined") return;
  const set = () => {
    const s = uiStyle();
    if (s === "classic") delete document.documentElement.dataset.uiStyle;
    else document.documentElement.dataset.uiStyle = s;
  };
  set();
  window.addEventListener(UI_STYLE_EVENT, set);
  // Another window of the app changed it.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) {
      set();
      window.dispatchEvent(new CustomEvent(UI_STYLE_EVENT));
    }
  });
}

export function setUiStyle(style: UiStyle): void {
  try {
    if (style === "classic") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, style);
  } catch {
    /* storage blocked: this window, this session */
  }
  window.dispatchEvent(new CustomEvent(UI_STYLE_EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(UI_STYLE_EVENT, cb);
  return () => window.removeEventListener(UI_STYLE_EVENT, cb);
}

export function useUiStyle(): UiStyle {
  return useSyncExternalStore(subscribe, uiStyle, () => "classic");
}
