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
import { MOTION_EVENT, fxOn, fxSwitchedOn, motionLevel, type MotionFx, type MotionLevel } from "./motionCore";

export * from "./motionCore";

function subscribe(cb: () => void): () => void {
  window.addEventListener(MOTION_EVENT, cb);
  return () => window.removeEventListener(MOTION_EVENT, cb);
}

export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(subscribe, motionLevel, () => "full");
}

/** The effect plays (its switch on, the level "full"); follows changes made anywhere. */
export function useFx(fx: MotionFx): boolean {
  return useSyncExternalStore(subscribe, () => fxOn(fx), () => false);
}

/** The effect's switch in Options, whatever the level. */
export function useFxSwitch(fx: MotionFx): boolean {
  return useSyncExternalStore(subscribe, () => fxSwitchedOn(fx), () => true);
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
