/**
 * The Scan route's distance reader, in the screen marker's page (plan 1.3.8, the launcher's HUD option): the game's
 * monitor (gameScreen.ts, shared with the pitch reader) read four times a second while the server's trigger holds
 * (useDistanceReader.ts), for the distance under the target's name (shared/hudTargetDistance.ts). Nothing is kept,
 * nothing leaves the PC.
 */
import { distanceArea, readTargetDistanceAnyColour, type Rgb, type TargetDistance } from "@shared/hudTargetDistance";
import { HUD_DISTANCE_GLYPHS } from "@shared/hudDistanceGlyphs";
import { HUD_DISTANCE_GLYPHS_ORANGE } from "@shared/hudDistanceGlyphsOrange";
import { watchEdhmHint } from "./edhmHint";
import { acquireGameScreen } from "./gameScreen";

/**
 * How often a frame is read: as the pitch reader (owner, 2026-11-05, of once a second: "I basically pass almost the
 * entire system before it updates").
 */
export const DISTANCE_EVERY_MS = 250;

/**
 * Round the last reading first (shares of the screen's height either way of its line's start): the label moves little
 * in a quarter second, and a small crop costs a fraction of the whole area's 25-40 ms. The whole area when it is not
 * there.
 */
const NEAR = { left: 0.12, right: 0.3, up: 0.1, down: 0.06 };

/**
 * Frames in a row without a reading before the learned HUD colour is let go and looked for again (2 s at four a
 * second): the commander may have switched EDHM's theme, or the colour was a wrong guess.
 */
const FORGET_COLOUR_AFTER = 8;

export interface DistanceCapture {
  stop(): void;
}

/** Start reading; `onRead` gets each result (null: not read). Resolves `{ error }` when the capture cannot start. */
export async function startDistanceCapture(onRead: (r: TargetDistance | null) => void): Promise<DistanceCapture | { error: string }> {
  const screen = await acquireGameScreen();
  if ("error" in screen) return screen;
  /** Where the last reading's line started, in screen pixels. */
  let near: { x: number; y: number } | null = null;
  /*
    The HUD's text colour, learned from the screen (owner 2026-11-06: EDHM themes draw it white, blue, red, ...; a
    colour picker "introduces a lot of uncertainty"): looked for while unknown, then read in.
  */
  let colour: Rgb | null = null;
  let misses = 0;
  /* EDHM's main text colour (server edhmColours.ts), a hint for finding the line; null without EDHM or in orange. */
  let hint: Rgb | null = null;
  const stopEdhm = watchEdhmHint((e) => {
    hint = e?.targetText ?? null;
  });
  const readIn = (x: number, y: number, w: number, h: number, vh: number): TargetDistance | null => {
    // No colour correction from the launcher: the reader learns the colour itself.
    const px = screen.crop(x, y, w, h);
    const r = px ? readTargetDistanceAnyColour(px, w, h, HUD_DISTANCE_GLYPHS, vh, colour, HUD_DISTANCE_GLYPHS_ORANGE, hint) : null;
    if (!r) return null;
    colour = r.colour;
    return { ...r.reading, x: r.reading.x + x, y: r.reading.y + y };
  };
  const read = () => {
    const vw = screen.width();
    const vh = screen.height();
    if (!vw || !vh) return onRead(null);
    let r: TargetDistance | null = null;
    if (near) {
      const x = Math.max(0, Math.round(near.x - vh * NEAR.left));
      const y = Math.max(0, Math.round(near.y - vh * NEAR.up));
      r = readIn(x, y, Math.min(vw - x, Math.round(vh * (NEAR.left + NEAR.right))), Math.min(vh - y, Math.round(vh * (NEAR.up + NEAR.down))), vh);
    }
    if (!r) {
      const a = distanceArea(vw, vh);
      r = readIn(a.x, a.y, a.w, a.h, vh);
    }
    near = r ? { x: r.x, y: r.y } : null;
    misses = r ? 0 : misses + 1;
    if (misses >= FORGET_COLOUR_AFTER) colour = null;
    onRead(r);
  };
  const timer = setInterval(read, DISTANCE_EVERY_MS);
  return {
    stop() {
      clearInterval(timer);
      stopEdhm();
      screen.release();
    },
  };
}
