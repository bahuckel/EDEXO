/**
 * EDHM's own HUD colours (server edhmColours.ts), asked of this PC's server for the screen marker's readers
 * (pitchCapture.ts, distanceCapture.ts): a hint where to look for the text, null without EDHM.
 */
import type { Rgb } from "@shared/hudTextLook";

export interface EdhmHint {
  pitchText: Rgb;
  pitchFrame: Rgb;
  /** The main text (the target's distance), null when it is the game's own orange. */
  targetText: Rgb | null;
}

/** EDHM's ini colours are asked for this often (F11 in game reloads a theme). */
const EDHM_EVERY_MS = 5000;

/** Ask now and every few seconds; `onHint` gets each answer. Returns the stop. */
export function watchEdhmHint(onHint: (h: EdhmHint | null) => void): () => void {
  const ask = () =>
    void fetch("/api/hud-colours/edhm")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { edhm?: EdhmHint | null } | null) => onHint(j?.edhm ? { ...j.edhm, targetText: j.edhm.targetText ?? null } : null))
      .catch(() => {});
  ask();
  const timer = setInterval(ask, EDHM_EVERY_MS);
  return () => clearInterval(timer);
}
