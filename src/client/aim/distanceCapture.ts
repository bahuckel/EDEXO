/**
 * The Scan route's distance reader, in the screen marker's page (plan 1.3.8, the launcher's HUD option): the game's
 * monitor (gameScreen.ts, shared with the pitch reader) read four times a second while the server's trigger holds
 * (useDistanceReader.ts), for the distance under the target's name (shared/hudTargetDistance.ts). Nothing is kept,
 * nothing leaves the PC.
 */
import { distanceArea, readTargetDistance, type TargetDistance } from "@shared/hudTargetDistance";
import { HUD_DISTANCE_GLYPHS } from "@shared/hudDistanceGlyphs";
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

export interface DistanceCapture {
  stop(): void;
}

/** Start reading; `onRead` gets each result (null: not read). Resolves `{ error }` when the capture cannot start. */
export async function startDistanceCapture(onRead: (r: TargetDistance | null) => void): Promise<DistanceCapture | { error: string }> {
  const screen = await acquireGameScreen();
  if ("error" in screen) return screen;
  /** Where the last reading's line started, in screen pixels. */
  let near: { x: number; y: number } | null = null;
  const readIn = (x: number, y: number, w: number, h: number, vh: number): TargetDistance | null => {
    const px = screen.crop(x, y, w, h, "distance");
    const r = px ? readTargetDistance(px, w, h, HUD_DISTANCE_GLYPHS, vh) : null;
    return r ? { ...r, x: r.x + x, y: r.y + y } : null;
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
    onRead(r);
  };
  const timer = setInterval(read, DISTANCE_EVERY_MS);
  return {
    stop() {
      clearInterval(timer);
      screen.release();
    },
  };
}
