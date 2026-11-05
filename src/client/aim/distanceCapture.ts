/**
 * The Scan route's distance reader, in the screen marker's page (plan 1.3.8, the launcher's HUD option): the game's
 * monitor (gameScreen.ts, shared with the pitch reader) read once a second in supercruise with a body of the system
 * targeted, for the distance under the target's name (shared/hudTargetDistance.ts). Nothing is kept, nothing leaves
 * the PC.
 */
import { distanceArea, readTargetDistance, type TargetDistance } from "@shared/hudTargetDistance";
import { HUD_DISTANCE_GLYPHS } from "@shared/hudDistanceGlyphs";
import { acquireGameScreen } from "./gameScreen";

/** How often a frame is read: supercruise closes a few hundred ls a second at most near a body, and the map is small. */
export const DISTANCE_EVERY_MS = 1000;

export interface DistanceCapture {
  stop(): void;
}

/** Start reading; `onRead` gets each result (null: not read). Resolves `{ error }` when the capture cannot start. */
export async function startDistanceCapture(onRead: (r: TargetDistance | null) => void): Promise<DistanceCapture | { error: string }> {
  const screen = await acquireGameScreen();
  if ("error" in screen) return screen;
  const read = () => {
    const vw = screen.width();
    const vh = screen.height();
    if (!vw || !vh) return onRead(null);
    const a = distanceArea(vw, vh);
    const px = screen.crop(a.x, a.y, a.w, a.h);
    onRead(px ? readTargetDistance(px, a.w, a.h, HUD_DISTANCE_GLYPHS, vh) : null);
  };
  const timer = setInterval(read, DISTANCE_EVERY_MS);
  return {
    stop() {
      clearInterval(timer);
      screen.release();
    },
  };
}
