/**
 * The interface font (owner, 2026-10-27: the EDEXO font, "careful with the scale"): Classic is Bahnschrift, as
 * before; EDEXO is the app's own face (public/fonts, public/tokens.css). Its capitals and lowercase stand as tall as
 * Bahnschrift's at the same size, so nothing grows taller; it is wider, so it starts as a choice, not the default.
 *
 * The choice is `<html data-font>`; tokens.css swaps `--hud-font` on it, which the app, the launcher, the HUD
 * overlays and the second screen all read. Kept per PC (every window of the app follows), like Motion. No React here:
 * the launcher imports it too.
 */
export type UiFont = "classic" | "edexo";

const KEY = "edexo.uiFont";
const EVENT = "edexo:ui-font";

export function uiFont(): UiFont {
  try {
    return localStorage.getItem(KEY) === "edexo" ? "edexo" : "classic";
  } catch {
    return "classic";
  }
}

/** Puts the choice on <html> (before the first paint) and keeps it there when it changes in any window. */
export function applyUiFont(): void {
  if (typeof document === "undefined") return;
  const set = () => {
    const root = document.documentElement;
    if (uiFont() === "edexo") root.dataset.font = "edexo";
    else delete root.dataset.font;
  };
  set();
  window.addEventListener(EVENT, set);
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) {
      set();
      window.dispatchEvent(new CustomEvent(EVENT));
    }
  });
}

export function setUiFont(font: UiFont): void {
  try {
    localStorage.setItem(KEY, font);
  } catch {
    /* storage blocked: this window, this session */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Fired in this window when the choice changes (options/FontSetting.tsx listens). */
export const UI_FONT_EVENT = EVENT;
