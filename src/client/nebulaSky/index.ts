/**
 * Puts the Nebula style's sky behind the app (styles/ui-styles.css reads `--nebula-sky`). Painted once for the
 * screen's size in a worker, then kept in the browser's cache so a later start shows it at once. Until it is
 * there the page is plain dark, then it fades in (`<html data-nebula-sky>`); where there is no worker it is painted
 * here, after the first frame.
 */
import { paintNebulaSky } from "./paint";
import type { NebulaJob } from "./worker";

/** Raise when the picture changes, or the old one stays in the cache. */
const VERSION = 1;
const CACHE = "edexo-nebula-sky";

let started = false;

function size(): { width: number; height: number; scale: number } {
  // The screen, not the window: resizing the window keeps the picture (it is drawn to cover).
  const width = Math.round(Math.max(window.screen?.width || 0, window.innerWidth, 320));
  const height = Math.round(Math.max(window.screen?.height || 0, window.innerHeight, 320));
  // The nebulae at no more than 1600 px across, smoothed up; the stars at full size.
  return { width, height, scale: Math.min(1, 1600 / Math.max(width, height)) };
}

/** Sets the picture, decoded first, then says it is there: the stylesheet fades it in from that frame. */
async function show(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    /* shown anyway; the browser decodes it on the way */
  }
  const html = document.documentElement;
  html.style.setProperty("--nebula-sky", `url("${url}")`);
  // Two frames: the picture is laid out at opacity 0 before the fade starts, or it would just appear.
  requestAnimationFrame(() => requestAnimationFrame(() => (html.dataset.nebulaSky = "")));
}

async function paint(job: NebulaJob): Promise<Blob | null> {
  if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    try {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      const blob = await new Promise<Blob | null>((resolve) => {
        w.onmessage = (e: MessageEvent<Blob | null>) => resolve(e.data);
        w.onerror = () => resolve(null);
        w.postMessage(job);
      });
      w.terminate();
      if (blob) return blob;
    } catch {
      /* no worker: painted here below */
    }
  }
  await new Promise((r) => setTimeout(r, 0));
  const pic = paintNebulaSky(job.width, job.height, job.scale);
  const cv = document.createElement("canvas");
  cv.width = pic.width;
  cv.height = pic.height;
  cv.getContext("2d")?.putImageData(new ImageData(pic.data, pic.width, pic.height), 0, 0);
  return new Promise((resolve) => cv.toBlob(resolve, "image/webp", 0.92));
}

/** Shows the sky; the first call does the work, later ones nothing. */
export async function showNebulaSky(): Promise<void> {
  if (started || typeof document === "undefined") return;
  started = true;
  const job = size();
  const key = `${location.origin}/__nebula-sky/v${VERSION}-${job.width}x${job.height}.webp`;
  const t0 = performance.now();
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) {
      await show(await hit.blob());
      performance.measure?.("edexo-nebula-sky-cached", { start: t0, end: performance.now() });
      return;
    }
  } catch {
    cache = null; // no cache (an address that is not secure, a phone on the LAN): painted every start
  }
  const blob = await paint(job);
  if (!blob) return;
  await show(blob);
  performance.measure?.("edexo-nebula-sky-painted", { start: t0, end: performance.now() });
  try {
    if (cache) {
      // Older sizes and versions go: one picture is kept.
      for (const old of await cache.keys()) await cache.delete(old);
      await cache.put(key, new Response(blob, { headers: { "content-type": "image/webp" } }));
    }
  } catch {
    /* full or blocked: painted again next start */
  }
}
