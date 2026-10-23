/**
 * How much the app moves (owner, 2026-10-23: "act less like a website and more like a piece of software. No jumping
 * around, no abrupt changes to screens, everything should be smooth, fast animations").
 *
 * - full: things fade and slide in and out (150-200 ms), rows that move slide to their new place;
 * - reduced: fades only, nothing slides (the default when the system asks for less motion);
 * - off: every change is instant.
 *
 * The level is `<html data-motion>`; motion.css keys every animation on it. `withTransition` is the one way a change
 * React makes by removing something (a pop-up closing, a sub-tab switching, a drawer closing) gets an exit: the page
 * before and after are cross-faded by the browser (View Transitions), the same as a tab switch.
 */
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export type MotionLevel = "full" | "reduced" | "off";

const KEY = "edexo.motion";
const EVENT = "edexo:motion";

function systemPrefersLess(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function stored(): MotionLevel | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "full" || v === "reduced" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function motionLevel(): MotionLevel {
  return stored() ?? (systemPrefersLess() ? "reduced" : "full");
}

/** Puts the level on <html> (before the first paint: main.tsx) and keeps it there when it changes anywhere. */
export function applyMotion(): void {
  if (typeof document === "undefined") return;
  const set = () => {
    document.documentElement.dataset.motion = motionLevel();
  };
  set();
  window.addEventListener(EVENT, set);
  // Another window of the app changed it.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      set();
      window.dispatchEvent(new CustomEvent(EVENT));
    }
  });
  if (typeof matchMedia === "function") matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", set);
}

export function setMotionLevel(level: MotionLevel): void {
  try {
    localStorage.setItem(KEY, level);
  } catch {
    /* storage blocked: this window, this session */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    motionLevel,
    () => "full",
  );
}

type ViewTransitionDocument = Document & { startViewTransition?: (cb: () => void) => unknown };

/**
 * Runs `update` (a state change that removes or swaps what is on screen) inside a short cross-fade, so the old view
 * fades out instead of vanishing. Instant with motion off, without the browser API (tests), or while the page is
 * hidden. The update is flushed inside the transition, so the new view is what the browser captures.
 */
export function withTransition(update: () => void): void {
  const d = typeof document === "undefined" ? null : (document as ViewTransitionDocument);
  if (!d || typeof d.startViewTransition !== "function" || motionLevel() === "off" || d.hidden) {
    update();
    return;
  }
  try {
    d.startViewTransition(() => flushSync(update));
  } catch {
    update();
  }
}
