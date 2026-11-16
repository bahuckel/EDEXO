/**
 * Paints the header's sky picture off the page (plan-1.4.0 §6.3): 100-200 ms of noise and spheres that would
 * otherwise hold up the window on every resize and scheme change. The page keeps showing the last sky until this
 * one arrives (HeaderArt.tsx), and paints it itself where a worker or an OffscreenCanvas is missing.
 */
import { paintSky, type SkyGeometry } from "./sky";

export interface SkyJob {
  id: number;
  geometry: SkyGeometry;
  accent: string;
  seed: number;
  calm: boolean;
}
export interface SkyDone {
  id: number;
  bitmap: ImageBitmap;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<SkyJob>) => void) | null; postMessage(m: SkyDone, transfer: Transferable[]): void };

scope.onmessage = (e) => {
  const job = e.data;
  const bitmap = (paintSky(job.geometry, job.accent, job.seed, job.calm) as OffscreenCanvas).transferToImageBitmap();
  scope.postMessage({ id: job.id, bitmap }, [bitmap]);
};
