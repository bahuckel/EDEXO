/**
 * The header artwork (owner, 2026-10-01: the Vista Genomics picture went on 2026-09-29, "draw a new one,
 * make sure it fits well behind all of the things there, neutral or synced with app color"; 2026-11-16:
 * "improved substantially", then "make the background rotate with the planet with time").
 *
 * A view from the ground of a planet: far ranges, hills, and plants standing on the near ground with the
 * sample rings round one of them, under a sky that turns once in thirty minutes (headerArt/scene.ts). It says
 * something about where the commander is: the skyline is the system's own, the land follows the kind of body
 * on show (icy, rocky, metal-rich), and the plants are the genera the app expects or has found on that body —
 * a body without biology is bare ground.
 *
 * Drawn, not a picture, and laid out against what is actually in the header: it runs from 350 × 476 on a
 * phone to 1816 × 135 on a wide screen, and where its cards sit moves with the width and the system. So the
 * land stays a thin line under the content and climbs where the header is free, and the sky is shaded behind
 * every block and line of text. Every colour comes from the scheme (`--accent-rgb`), so it follows the colour
 * scheme like the rest of the app. `aria-hidden`, under the header's content.
 *
 * The land is built once per layout, scheme or body change; the sky picture, which depends on none of the
 * header's blocks, is painted in a worker and kept between rebuilds. After that a frame only moves the sky.
 * How much of it shows is the commander's choice (Options › Look › Header picture); the sky turns only while
 * Motion is Full and the window is on show.
 */
import { memo, useLayoutEffect, useRef } from "react";
import { APP_THEME_EVENT } from "./appTheme";
import { landStyleOf } from "./headerArt/land";
import { drawnRects, type Layout } from "./headerArt/layout";
import { seedOf } from "./headerArt/maths";
import { useHeaderArtMode } from "./headerArt/mode";
import { plantsOfGenera } from "./headerArt/plants";
import { turningScene, type TurningScene } from "./headerArt/scene";
import { ROTATION_S, paintSky, skyGeometry, type SkyGeometry } from "./headerArt/sky";
import type { SkyDone, SkyJob } from "./headerArt/skyWorker";
import { MOTION_EVENT, motionLevel } from "./motionCore";

/**
 * The sky is redrawn 60 times a second, each time at its exact place (a fraction of a pixel on), so it glides
 * (owner, 2026-11-17: 10 steps a second looked choppy, a pixel at a time worse; "60 fps with smooth transitions").
 * Timed on the screen's frames, so a faster screen still draws it 60 times, not 144 or 164.
 */
const STEP_MS = 1000 / 60;
/** One clock for the page, so a rebuilt picture carries on where the last one was. */
const STARTED = performance.now();
const turnNow = () => ((performance.now() - STARTED) / 1000 / ROTATION_S) % 1;

/* ---- the sky picture: painted in a worker, the last one kept ---- */

interface SkyPicture {
  key: string;
  image: CanvasImageSource;
  geometry: SkyGeometry;
}
let lastSky: SkyPicture | null = null;
let worker: Worker | null | undefined;
let jobs = 0;
const waiting = new Map<number, (image: CanvasImageSource) => void>();
/** The jobs the worker has, so the page can paint them itself if the worker dies. */
const pending = new Map<number, SkyJob>();

function skyWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  try {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
    const w = new Worker(new URL("./headerArt/skyWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<SkyDone>) => {
      const done = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      if (done) done(e.data.bitmap);
      else e.data.bitmap.close();
    };
    // The worker failed to load or died: what waits is painted on the page, and so is every later sky.
    w.onerror = () => {
      worker = null;
      for (const [id, done] of [...waiting]) {
        waiting.delete(id);
        const job = pending.get(id);
        if (job) done(paintSky(job.geometry, job.accent, job.seed, job.calm));
      }
      pending.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Asks for a sky picture; `done` gets it later (from the worker, or painted here where there is none). */
function requestSky(job: Omit<SkyJob, "id">, done: (image: CanvasImageSource) => void): () => void {
  const id = ++jobs;
  const w = skyWorker();
  const t0 = performance.now();
  const finish = (image: CanvasImageSource) => {
    pending.delete(id);
    performance.measure?.("edexo-header-art-sky", { start: t0, end: performance.now() });
    done(image);
  };
  if (w) {
    waiting.set(id, finish);
    pending.set(id, { id, ...job });
    w.postMessage({ id, ...job } satisfies SkyJob);
    return () => {
      // Not wanted any more: when it arrives it is closed, not shown.
      waiting.delete(id);
      pending.delete(id);
    };
  }
  const timer = window.setTimeout(() => finish(paintSky(job.geometry, job.accent, job.seed, job.calm)), 0);
  return () => window.clearTimeout(timer);
}

function measure(host: HTMLElement, art: Element): Layout {
  const text: Layout["taken"] = [];
  return { w: host.clientWidth, h: host.clientHeight, taken: drawnRects(host, art, text), text };
}

interface Props {
  /** The system on show: its name is the skyline's seed. */
  system?: string | null;
  /** The body on show in the Body panel: its plants' line-up, its kind of land. */
  bodyKey?: string | null;
  planetClass?: string | null;
  /** The genus folders (`genusDataDir`) the app shows for that body, likeliest first, comma-separated. */
  genera?: string;
}

export const HeaderArt = memo(function HeaderArt({ system, bodyKey, planetClass, genera = "" }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mode = useHeaderArtMode();
  useLayoutEffect(() => {
    const box = ref.current;
    const host = box?.parentElement;
    if (!box || !host) return;
    if (mode === "off") {
      box.replaceChildren();
      return;
    }
    const calm = mode === "calm";
    const turning = () => mode === "turning" && motionLevel() === "full";
    const seed = seedOf(system);
    const plants = plantsOfGenera(genera ? genera.split(",") : []);
    let scene: TurningScene | null = null;
    let key = "";
    let wanted = "";
    let timer = 0;
    let alive = true;
    let cancelSky: (() => void) | null = null;

    const build = () => {
      const L = measure(host, box);
      if (L.w < 2 || L.h < 2) return;
      const cs = getComputedStyle(host);
      const accent = cs.getPropertyValue("--accent-rgb").trim() || "255, 138, 31";
      const shade = cs.getPropertyValue("--shade-top-rgb").trim() || "12, 7, 4";
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // A block that moved by a pixel or two (a counter gaining a digit) is the same layout.
      const next = JSON.stringify([L.w, L.h, dpr, accent, shade, L.taken.map((r) => r.map((v) => Math.round(v / 4)))]);
      if (next === key) return;
      key = next;
      const t0 = performance.now();
      // Built aside and swapped in whole, so the header never shows a half-drawn picture.
      const layers = document.createElement("div");
      const made = turningScene(layers, L, { accent, shade, seed, plantSeed: seedOf(`${system ?? ""}|${bodyKey ?? ""}`), dpr, style: landStyleOf(planetClass), plants, calm });
      scene = made;
      performance.measure?.("edexo-header-art-land", { start: t0, end: performance.now() });
      // The sky: the one kept if it is this header's, else the last one until the new one is painted.
      const geometry = skyGeometry(L.w, L.h, dpr);
      const skyKey = JSON.stringify([L.w, L.h, dpr, accent, seed, calm]);
      if (lastSky) made.setSky(lastSky.image, lastSky.geometry);
      if (lastSky?.key !== skyKey && wanted !== skyKey) {
        wanted = skyKey;
        cancelSky?.();
        cancelSky = requestSky({ geometry, accent, seed, calm }, (image) => {
          const old = lastSky;
          lastSky = { key: skyKey, image, geometry };
          if (old && old.image !== image && "close" in old.image) old.image.close();
          if (alive && wanted === skyKey) scene?.setSky(image, geometry);
        });
      }
      made.step(turning() ? turnNow() : 0);
      box.replaceChildren(layers);
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(build, scene ? 250 : 0);
    };
    schedule();

    // The header's size, each of its blocks, and blocks coming and going (a Notable card, a route card).
    const ro = new ResizeObserver(schedule);
    ro.observe(host);
    for (const child of host.children) if (child !== box) ro.observe(child);
    const mo = new MutationObserver((records) => {
      if (records.some((r) => !box.contains(r.target))) schedule();
    });
    mo.observe(host, { childList: true, subtree: true });
    window.addEventListener(APP_THEME_EVENT, schedule);
    // Motion switched: the sky goes back to where the turn starts, or carries on.
    const onMotion = () => {
      scene?.step(turning() ? turnNow() : 0);
      run();
    };
    window.addEventListener(MOTION_EVENT, onMotion);

    // Frames stop by themselves while the window is hidden; the loop stops when the sky stops turning.
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = 0;
      if (!turning()) return;
      // A little early still counts, or a 60 Hz screen would skip every other frame; counted from when the last one
      // was due, so a 164 Hz screen averages 60 too, not 55.
      if (now - last >= STEP_MS - 2) {
        last = now - last > 100 ? now : last + STEP_MS;
        scene?.step(turnNow());
      }
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      if (!frame && turning()) frame = requestAnimationFrame(tick);
    };
    run();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      cancelSky?.();
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener(APP_THEME_EVENT, schedule);
      window.removeEventListener(MOTION_EVENT, onMotion);
    };
  }, [mode, system, bodyKey, planetClass, genera]);
  return <div ref={ref} className="header-art" aria-hidden="true" />;
});
