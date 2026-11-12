/// <reference lib="webworker" />
/**
 * Lifts the galaxy picture into 3D clouds off the main thread (galaxySprites.ts; regionBackdrop.ts asks):
 * the picture's pixels in, the sprites out.
 */
import { galaxyCloudSprites, pictureDust, type CloudFrame } from "@shared/galaxySprites";

type Ask = { frame: CloudFrame; rgba: ArrayBuffer; sprites: { emission: number; dust: number } };

self.onmessage = (ev: MessageEvent<Ask>) => {
  const { frame, sprites } = ev.data;
  const rgba = new Uint8ClampedArray(ev.data.rgba);
  const out = galaxyCloudSprites(frame, rgba, pictureDust(frame, rgba), sprites);
  (self as unknown as Worker).postMessage(out.buffer, [out.buffer]);
};
