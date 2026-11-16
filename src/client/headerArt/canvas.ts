/**
 * Canvases for the header artwork, on the page or in its worker. The sky picture is painted in a worker
 * (skyWorker.ts), where there is no document: there an OffscreenCanvas stands in. Both draw the same way, so
 * the painters are written against the page's 2D context type.
 */
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx = CanvasRenderingContext2D;

export function newCanvas(w: number, h: number): AnyCanvas {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    return cv;
  }
  return new OffscreenCanvas(width, height);
}

/** The canvas' 2D context. An OffscreenCanvas' context has every call the painters use. */
export function ctx2d(cv: AnyCanvas): Ctx {
  return cv.getContext("2d") as unknown as Ctx;
}

/** A canvas of `w` × `h` header pixels at `dpr` device pixels each, its context already scaled. */
export function layerCanvas(w: number, h: number, dpr: number): [AnyCanvas, Ctx] {
  const cv = newCanvas(w * dpr, h * dpr);
  const cx = ctx2d(cv);
  cx.scale(dpr, dpr);
  return [cv, cx];
}
