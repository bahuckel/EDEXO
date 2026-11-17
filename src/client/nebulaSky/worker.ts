/**
 * Paints the Nebula style's sky off the page: about a second of noise for a 2560 × 1440 screen that would
 * otherwise hold up the window. Sends back a WebP the page sets as its background (index.ts).
 */
import { paintNebulaSky } from "./paint";

export interface NebulaJob {
  width: number;
  height: number;
  scale: number;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<NebulaJob>) => void) | null; postMessage(m: Blob | null): void };

scope.onmessage = async (e) => {
  try {
    const pic = paintNebulaSky(e.data.width, e.data.height, e.data.scale);
    const cv = new OffscreenCanvas(pic.width, pic.height);
    const cx = cv.getContext("2d");
    if (!cx) throw new Error("no 2d context");
    cx.putImageData(new ImageData(pic.data, pic.width, pic.height), 0, 0);
    scope.postMessage(await cv.convertToBlob({ type: "image/webp", quality: 0.92 }));
  } catch {
    scope.postMessage(null);
  }
};
